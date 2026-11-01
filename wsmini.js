// Minimal dependency-free WebSocket server (RFC 6455) - just what the relay needs:
// text/binary frames, fragmentation, ping/pong, close. API mirrors the subset of
// the "ws" package used by server.js.
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WsSocket extends EventEmitter {
  constructor(sock, maxPayload) {
    super();
    this.sock = sock;
    this.maxPayload = maxPayload;
    this.readyState = 1; // 1 = OPEN, 2 = CLOSING, 3 = CLOSED
    this.buf = Buffer.alloc(0);
    this.frag = null;
    sock.setNoDelay(true);
    sock.on('data', (d) => this._onData(d));
    sock.on('close', () => this._finish());
    sock.on('error', () => this._finish());
  }

  _finish() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    try { this.sock.destroy(); } catch (e) { /* ignore */ }
    this.emit('close');
  }

  _fail() {
    this._writeFrame(0x8, Buffer.from([0x03, 0xea])); // 1002 protocol error
    this._finish();
  }

  _onData(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      if (this.readyState === 3) return;
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        if (b.readUInt32BE(2) !== 0) return this._fail();
        len = b.readUInt32BE(6);
        off = 10;
      }
      if (!masked || len > this.maxPayload) return this._fail();
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      this._onFrame(fin, opcode, payload);
    }
  }

  _onFrame(fin, opcode, payload) {
    switch (opcode) {
      case 0x0: // continuation
        if (!this.frag) return this._fail();
        this.frag.size += payload.length;
        if (this.frag.size > this.maxPayload) return this._fail();
        this.frag.chunks.push(payload);
        if (fin) {
          const full = Buffer.concat(this.frag.chunks);
          this.frag = null;
          this.emit('message', full);
        }
        break;
      case 0x1: // text
      case 0x2: // binary
        if (fin) this.emit('message', payload);
        else this.frag = { chunks: [payload], size: payload.length };
        break;
      case 0x8: // close
        if (this.readyState === 1) this._writeFrame(0x8, payload.subarray(0, 2));
        this.readyState = 2;
        try { this.sock.end(); } catch (e) { /* ignore */ }
        break;
      case 0x9: // ping
        this._writeFrame(0xA, payload);
        break;
      case 0xA: // pong
        this.emit('pong');
        break;
      default:
        this._fail();
    }
  }

  _writeFrame(opcode, payload) {
    if (this.readyState === 3 || !this.sock.writable) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(len, 6);
    }
    try { this.sock.write(Buffer.concat([header, payload])); } catch (e) { /* ignore */ }
  }

  send(data) {
    if (this.readyState !== 1) return;
    if (typeof data === 'string') this._writeFrame(0x1, Buffer.from(data, 'utf8'));
    else this._writeFrame(0x2, Buffer.from(data));
  }

  ping() { if (this.readyState === 1) this._writeFrame(0x9, Buffer.alloc(0)); }

  close() {
    if (this.readyState !== 1) return;
    this._writeFrame(0x8, Buffer.from([0x03, 0xe8]));
    this.readyState = 2;
    try { this.sock.end(); } catch (e) { /* ignore */ }
    setTimeout(() => this._finish(), 1000).unref();
  }

  terminate() { this._finish(); }
}

class WebSocketServer extends EventEmitter {
  constructor(opts) {
    super();
    this.maxPayload = (opts && opts.maxPayload) || 1024 * 1024;
    this.clients = new Set();
    opts.server.on('upgrade', (req, socket, head) => this._upgrade(req, socket, head));
  }

  _upgrade(req, socket, head) {
    const key = req.headers['sec-websocket-key'];
    const upgrade = String(req.headers.upgrade || '').toLowerCase();
    if (!key || upgrade !== 'websocket') {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
    );
    const ws = new WsSocket(socket, this.maxPayload);
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    this.emit('connection', ws, req);
    if (head && head.length) ws._onData(head);
  }
}

module.exports = { WebSocketServer };
