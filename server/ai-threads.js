// Private AI threads for Chat (/ai): one list per person per space, kept so a refresh does not lose
// the conversation. Written the way chat-history.js writes (soon after a change, and on stop).
// Last MAX_PER_THREAD entries, none older than MAX_AGE_MS. Not kept for an aside (the caller never
// asks). Persists to DATA_DIR/ai-threads.json.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_PER_THREAD = 200;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TEXT = 8000;

class AiThreads {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'ai-threads.json');
    this.threads = {}; // "<spaceId>:<userId>" -> [{ id, at, role, text, summaries? }]
    this.timer = null;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && raw.threads && typeof raw.threads === 'object') this.threads = raw.threads;
    } catch {
      // first run
    }
  }

  key(spaceId, userId) {
    return `${spaceId}:${userId}`;
  }

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
      fs.writeFileSync(tmp, JSON.stringify({ threads: this.threads }));
      fs.renameSync(tmp, this.file);
    } catch {
      // the thread still works in memory
    }
  }

  prune(key) {
    const cutoff = Date.now() - MAX_AGE_MS;
    const list = (this.threads[key] || []).filter((m) => m.at >= cutoff).slice(-MAX_PER_THREAD);
    if (list.length) this.threads[key] = list;
    else delete this.threads[key];
  }

  list(spaceId, userId) {
    const key = this.key(spaceId, userId);
    this.prune(key);
    return (this.threads[key] || []).map((m) => ({ ...m, summaries: m.summaries ? m.summaries.map((s) => ({ ...s })) : undefined }));
  }

  add(spaceId, userId, { role, text, summaries, shared }) {
    if (role !== 'user' && role !== 'ai') return null;
    const clean = String(text ?? '').replace(/\p{Cc}/gu, (c) => (c === '\n' || c === '\t' ? c : '')).trim().slice(0, MAX_TEXT);
    if (!clean) return null;
    const entry = { id: crypto.randomBytes(6).toString('hex'), at: Date.now(), role, text: clean };
    if (role === 'ai' && Array.isArray(summaries) && summaries.length) entry.summaries = summaries.slice(0, 20);
    if (shared) entry.shared = true;
    const key = this.key(spaceId, userId);
    if (!this.threads[key]) this.threads[key] = [];
    this.threads[key].push(entry);
    this.prune(key);
    this.save();
    return entry;
  }

  clear(spaceId, userId) {
    const key = this.key(spaceId, userId);
    if (this.threads[key]) {
      delete this.threads[key];
      this.save();
    }
  }

  forgetSpace(spaceId) {
    const prefix = `${spaceId}:`;
    let changed = false;
    for (const key of Object.keys(this.threads)) {
      if (key.startsWith(prefix)) {
        delete this.threads[key];
        changed = true;
      }
    }
    if (changed) this.save();
  }
}

module.exports = { AiThreads, AI_THREAD_LIMITS: { MAX_PER_THREAD, MAX_AGE_MS, MAX_TEXT } };
