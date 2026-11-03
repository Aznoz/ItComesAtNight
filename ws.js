'use strict';
// Minimal dependency-free WebSocket server (RFC 6455, text frames, fragmentation, ping/pong, close).
// Enough for a game relay: no extensions, no sub-protocols, client frames must be masked.
const crypto = require('crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 64 * 1024;

class WsConn {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frag = null;
    this.open = true;
    this.onmessage = null;
    this.onclose = null;
    this.alive = true;
    this.lastPong = Date.now();
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
    socket.on('end', () => this.finish());
  }

  finish() {
    if (!this.open) return;
    this.open = false;
    try { this.socket.destroy(); } catch (e) { /* ignore */ }
    if (this.onclose) { try { this.onclose(); } catch (e) { console.error('onclose', e); } }
  }

  onData(d) {
    if (!this.open) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    if (this.buf.length > MAX_PAYLOAD * 4) { this.close(1009); return; }
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; const hi = b.readUInt32BE(2), lo = b.readUInt32BE(6); if (hi !== 0) { this.close(1009); return; } len = lo; off = 10; }
      if (len > MAX_PAYLOAD) { this.close(1009); return; }
      if (!masked) { this.close(1002); return; }
      if (b.length < off + 4 + len) return;
      const mask = b.slice(off, off + 4);
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = b[off + 4 + i] ^ mask[i & 3];
      this.buf = b.slice(off + 4 + len);
      this.frame(fin, op, payload);
      if (!this.open) return;
    }
  }

  frame(fin, op, payload) {
    this.lastPong = Date.now();
    if (op === 0x8) { this.close(1000); return; }
    if (op === 0x9) { this.raw(0xA, payload); return; }
    if (op === 0xA) { this.lastPong = Date.now(); return; }
    if (op === 0x1 || op === 0x2) { this.frag = { op, parts: [payload] }; }
    else if (op === 0x0) { if (!this.frag) return; this.frag.parts.push(payload); }
    else return;
    if (fin) {
      const all = this.frag.parts.length === 1 ? this.frag.parts[0] : Buffer.concat(this.frag.parts);
      this.frag = null;
      if (this.onmessage) { try { this.onmessage(all.toString('utf8')); } catch (e) { console.error('onmessage', e); } }
    }
  }

  raw(op, payload) {
    if (!this.open) return;
    const len = payload.length;
    let head;
    if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
    head[0] = 0x80 | op;
    try { this.socket.write(Buffer.concat([head, payload])); } catch (e) { this.finish(); }
  }

  send(str) {
    if (!this.open) return false;
    if (this.socket.writableLength > 512 * 1024) return false;   // client is too slow: drop instead of buffering
    this.raw(0x1, Buffer.from(str, 'utf8'));
    return true;
  }
  ping() { this.raw(0x9, Buffer.alloc(0)); }
  close(code) {
    if (!this.open) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(code || 1000, 0);
    this.raw(0x8, p);
    setTimeout(() => this.finish(), 50);
  }
}

function attach(server, onConnection) {
  const conns = new Set();
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    const c = new WsConn(socket);
    conns.add(c);
    c.addr = req.headers['x-forwarded-for'] || socket.remoteAddress || '';
    const prev = () => conns.delete(c);
    const oc = () => { prev(); };
    c.onclose = null;
    onConnection(c);
    const userClose = c.onclose;
    c.onclose = () => { oc(); if (userClose) userClose(); };
  });
  const timer = setInterval(() => {
    const now = Date.now();
    for (const c of conns) {
      if (now - c.lastPong > 90000) { c.finish(); continue; }
      c.ping();
    }
  }, 20000);
  timer.unref();
  return { conns };
}

module.exports = { attach };
