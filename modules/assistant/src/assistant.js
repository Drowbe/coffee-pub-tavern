// Assistant: no window of its own. Chat's /ai is the conversation. This module
// keeps the Use permission (which gates /ai) and fulfils askAssistant by asking
// in Chat, so a drop-menu "Ask the assistant" does not wait on a page that never opens.
(async () => {
  'use strict';

  const host = (document.currentScript && document.currentScript.host) || window.host;
  const root = host.root;
  const $ = (id) => root.getElementById(id);

  try {
    await host.ready();
  } catch (err) {
    $('msg').textContent = 'Assistant could not start: ' + ((err && err.message) || err);
    return;
  }

  host.util.fillWords($('note'));

  if (host.actions && host.actions.provide) {
    host.actions.provide({
      askAssistant: async (input) => {
        const i = input || {};
        const question = typeof i.question === 'string' && i.question.trim()
          ? i.question.trim().slice(0, 1000)
          : (i.ref ? 'What should I know about this?' : '');
        if (!question) return {};
        await host.chat.ask({ question, refs: i.ref ? [i.ref] : [] });
        return {};
      },
    });
  }

  $('msg').hidden = true;
  $('app').hidden = false;
})();
