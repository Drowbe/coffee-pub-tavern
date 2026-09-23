  // Shared by the calendar and its dashboard widget (inlined into both by the build).
  const DAY = 24 * 60 * 60 * 1000;

  // --- dates ---------------------------------------------------------------

  const pad = (n) => String(n).padStart(2, '0');
  const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  function startOf(ev) {
    return ev.allDay ? parseYmd(ev.start) : new Date(ev.start);
  }
  // Times on the server's clock (host.util.hour12, read each time: the lib is inlined after the page's own code, so nothing
  // here may be called during the page's start-up); 12-hour where there is no host (the checks).
  const timeText = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: typeof host === 'undefined' || !host.util || !host.util.hour12 ? true : host.util.hour12() });
  const shortDay = (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

  // An event runs from `start` to `end`, which may be days later. A timed event's end is a date and
  // time; an all-day event's end is the last day (inclusive). Neither: it lasts as long as it lasts
  // on the one day it starts.
  function durationOf(ev) {
    if (ev.allDay) return ev.end ? Math.max(0, parseYmd(ev.end) - parseYmd(ev.start)) + DAY : DAY;
    return ev.end ? Math.max(0, new Date(ev.end) - new Date(ev.start)) : 0;
  }
  // When one occurrence (starting at `start`) ends: a moment, exclusive.
  const endOf = (ev, start) => new Date(start.getTime() + durationOf(ev));

  function whenText(ev, start, end) {
    const last = new Date(end.getTime() - (ev.allDay ? 1 : 0));
    const multi = startOfDay(last) > startOfDay(start);
    if (ev.allDay) return multi ? `${shortDay(start)} - ${shortDay(last)}` : 'All day';
    if (!ev.end) return timeText(start);
    return multi ? `${shortDay(start)} ${timeText(start)} - ${shortDay(end)} ${timeText(end)}` : `${timeText(start)} - ${timeText(end)}`;
  }
  const dayHeading = (d) => d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const REPEAT_NAMES = { day: 'daily', week: 'weekly', '2weeks': 'every 2 weeks', month: 'monthly', year: 'yearly' };

  // --- repeating events -------------------------------------------------------
  // An event may repeat: { every: 'day' | 'week' | '2weeks' | 'month' | 'year', until: 'YYYY-MM-DD' | null }.
  // The whole series is one event, so changing it changes every occurrence. A
  // repeat keeps the wall-clock time and, monthly, the day of the month (or the
  // last day of a shorter month).

  function occurrenceAt(first, every, i) {
    const y = first.getFullYear();
    const m = first.getMonth();
    const d = first.getDate();
    const h = first.getHours();
    const mi = first.getMinutes();
    if (every === 'day') return new Date(y, m, d + i, h, mi);
    if (every === 'week') return new Date(y, m, d + 7 * i, h, mi);
    if (every === '2weeks') return new Date(y, m, d + 14 * i, h, mi);
    const months = every === 'year' ? 12 * i : i;
    const last = new Date(y, m + months + 1, 0).getDate();
    return new Date(y, m + months, Math.min(d, last), h, mi);
  }

  // The start times of one event that fall in [from, to).
  function occurrences(ev, from, to) {
    const first = startOf(ev);
    if (!ev.repeat) return first >= from && first < to ? [first] : [];
    const every = ev.repeat.every;
    const until = ev.repeat.until ? endOfDay(parseYmd(ev.repeat.until)) : null;
    let i = 0;
    if (from > first) {
      // Skip ahead rather than walk every day since the first one.
      const days = (from - first) / DAY;
      const skip = every === 'day' ? days : every === 'week' ? days / 7 : every === '2weeks' ? days / 14 : every === 'month' ? days / 31 : days / 366;
      i = Math.max(0, Math.floor(skip) - 1);
    }
    const out = [];
    for (let n = 0; n < 1500; n += 1, i += 1) {
      const at = occurrenceAt(first, every, i);
      if (at >= to || (until && at > until)) break;
      if (at >= from) out.push(at);
    }
    return out;
  }
