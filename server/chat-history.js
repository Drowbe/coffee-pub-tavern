// A room's recent chat, kept on the server so someone who joins later (or from another browser) reads what was
// said. Messages still travel live over LiveKit's data channel; the sender also posts the text here. Only text is
// kept (not pictures), only for a real room (an aside is meant to be off the record), and only a rolling window:
// the last MAX_PER_ROOM messages, none older than MAX_AGE_MS. Persists to DATA_DIR/chat.json.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_PER_ROOM = 500;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TEXT = 1000;

class ChatHistory {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'chat.json');
    this.rooms = {}; // roomId -> [{ id, at, by, who, text }], oldest first
    this.timer = null;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && typeof raw.rooms === 'object') this.rooms = raw.rooms;
    } catch {
      // first run
    }
  }

  // Written soon after a change, not on every message, and once more when the server stops.
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 2000);
    if (this.timer.unref) this.timer.unref();
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ rooms: this.rooms }));
      fs.renameSync(tmp, this.file);
    } catch {
      // the chat still works; it just is not kept this time
    }
  }

  prune(roomId) {
    const cutoff = Date.now() - MAX_AGE_MS;
    const list = (this.rooms[roomId] || []).filter((m) => m.at >= cutoff).slice(-MAX_PER_ROOM);
    if (list.length) this.rooms[roomId] = list;
    else delete this.rooms[roomId];
  }

  list(roomId) {
    this.prune(roomId);
    return (this.rooms[roomId] || []).map((m) => ({ ...m }));
  }

  // `by` is the sender's user key ('guest' for a guest), `who` the name to show.
  add(roomId, { by, who, text }) {
    const clean = String(text ?? '').replace(/\p{Cc}/gu, (c) => (c === '\n' || c === '\t' ? c : '')).trim().slice(0, MAX_TEXT);
    if (!clean) return null;
    const name = String(who || '').replace(/\p{Cc}/gu, ' ').trim().slice(0, 40) || 'someone';
    const message = { id: crypto.randomBytes(6).toString('hex'), at: Date.now(), by: String(by || 'guest').slice(0, 40), who: name, text: clean };
    if (!this.rooms[roomId]) this.rooms[roomId] = [];
    this.rooms[roomId].push(message);
    this.prune(roomId);
    this.save();
    return message;
  }

  forgetRoom(roomId) {
    if (this.rooms[roomId]) {
      delete this.rooms[roomId];
      this.save();
    }
  }
}

module.exports = { ChatHistory, CHAT_LIMITS: { MAX_PER_ROOM, MAX_AGE_MS, MAX_TEXT } };
