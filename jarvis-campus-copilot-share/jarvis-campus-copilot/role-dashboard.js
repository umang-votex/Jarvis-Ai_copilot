(() => {
  const app = document.querySelector('.app'), original = document.querySelector('.grid'), footer = document.querySelector('.foot');
  const host = document.createElement('section'); host.id = 'roleDashboard'; host.hidden = true; app.insertBefore(host, original);
  let user = null, events = [], postCount = 0, timer = null;
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const localDate = date => { const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return d.toISOString().slice(0, 10); };
  const clockText = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Time not set' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  const dateText = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); };
  const dayGap = value => { const now = new Date(); now.setHours(0, 0, 0, 0); const date = new Date(value); date.setHours(0, 0, 0, 0); return Math.ceil((date - now) / 86400000); };
  async function refresh() {
    if (!user) return;
    try {
      const [calendar, posts] = await Promise.all([fetch('/api/lms/events'), fetch('/api/lms/items')]);
      const eventData = await calendar.json(), postData = await posts.json();
      if (!calendar.ok) throw new Error(eventData.error || 'Could not load your planner.');
      events = eventData.events || []; postCount = posts.ok ? postData.items?.length || 0 : 0;
      render();
    } catch (error) { host.innerHTML = `<section class="role-panel role-error">${safe(error.message)}</section>`; }
  }
  function changeRole(nextUser) {
    user = nextUser && nextUser.name ? nextUser : null;
    clearInterval(timer); timer = null;
    const campus = document.getElementById('campusLaunch');
    if (!user) {
      document.getElementById('lmsClose')?.click(); document.getElementById('campusClose')?.click();
      host.hidden = true; host.innerHTML = ''; original.hidden = false; footer.hidden = false;
      app.classList.remove('role-teacher', 'role-student'); if (campus) campus.hidden = false;
      return;
    }
    const teacher = user.role === 'teacher';
    if (teacher) document.getElementById('campusClose')?.click();
    app.classList.toggle('role-teacher', teacher); app.classList.toggle('role-student', !teacher);
    if (campus) campus.hidden = teacher;
    original.hidden = true; footer.hidden = true; host.hidden = false;
    refresh();
    if (!teacher) timer = setInterval(() => { if (user?.role === 'student') refresh(); }, 60000);
  }
  document.addEventListener('jarvis-auth-changed', event => changeRole(event.detail));
  function eventCard(event, isTeacher = false) {
    const labels = { class: 'CLASS', break: 'BREAK', exam: 'EXAM', test: 'TEST', assignment: 'ASSIGNMENT' };
    return `<article class="role-event"><div class="role-event-time">${clockText(event.start_at)}${event.end_at ? `<small>TO ${clockText(event.end_at)}</small>` : ''}</div><div class="role-event-info"><span class="role-tag tag-${safe(event.kind)}">${labels[event.kind] || safe(event.kind)}</span><strong>${safe(event.title)}</strong><small>${safe(event.course || 'Campus')} · ${dateText(event.start_at)}${!isTeacher && event.teacher_name ? ` · ${safe(event.teacher_name)}` : ''}</small>${event.details ? `<p>${safe(event.details)}</p>` : ''}</div>${isTeacher ? `<button class="role-delete" data-delete-event="${safe(event.id)}" title="Remove event" aria-label="Remove ${safe(event.title)}">×</button>` : ''}</article>`;
  }
  function bindSchedule() {
    host.querySelectorAll('[data-delete-event]').forEach(button => button.onclick = async () => {
      if (!confirm('Remove this event from your planner and the shared student schedule?')) return;
      const response = await fetch(`/api/lms/events/${button.dataset.deleteEvent}`, { method: 'DELETE' });
      if (response.ok) refresh();
    });
    const form = document.getElementById('roleEventForm');
    if (!form) return;
    form.onsubmit = async event => {
      event.preventDefault(); const data = new FormData(form), date = data.get('date'), start = data.get('start'), end = data.get('end');
      const payload = { kind: data.get('kind'), title: data.get('title'), course: data.get('course'), startAt: `${date}T${start}`, endAt: end ? `${date}T${end}` : '', details: data.get('details') };
      const error = document.getElementById('roleEventError');
      try { const response = await fetch('/api/lms/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }), result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not save this event.'); form.reset(); form.elements.date.value = localDate(new Date()); error.textContent = 'Added to your planner and shared student timetable.'; await refresh(); }
      catch (err) { error.textContent = err.message; }
    };
  }
  function dashboardFrame(content, roleName) {
    return `<div class="role-welcome"><div><span class="eyebrow">J.A.R.V.I.S. // ${roleName}</span><h1>Hi, ${safe(user.name)}.</h1><p>${roleName === 'TEACHER' ? 'Your classes, classroom posts, and teaching day.' : 'Your class schedule, learning materials, and upcoming deadlines.'}</p></div><div class="role-welcome-actions"><button class="secondary" data-open-lms>▤ LEARNING COMMONS</button>${roleName === 'STUDENT' ? '<button class="secondary" data-open-campus>◫ STUDENT HUB</button>' : ''}</div></div>${content}`;
  }
  function renderTeacher() {
    const today = localDate(new Date());
    const todayEvents = events.filter(event => event.start_at.slice(0, 10) === today);
    const upcoming = events.filter(event => event.start_at.slice(0, 10) > today).slice(0, 5);
    const date = localDate(new Date());
    const eventRows = todayEvents.length ? todayEvents.map(event => eventCard(event, true)).join('') : '<div class="role-empty">Nothing is scheduled today. Add a class, break, test, exam, or assignment to your planner.</div>';
    const nextRows = upcoming.map(event => eventCard(event, true)).join('') || '<div class="role-empty">No upcoming planner events yet.</div>';
    host.innerHTML = dashboardFrame(`<div class="role-stats"><article class="role-stat"><span>CLASSES TODAY</span><b>${todayEvents.filter(e => e.kind === 'class').length}</b><small>from your teaching planner</small></article><article class="role-stat"><span>UPCOMING EVENTS</span><b>${events.filter(e => e.start_at.slice(0,10) >= today).length}</b><small>classes, breaks, tests, exams</small></article><article class="role-stat"><span>YOUR POSTS</span><b>${postCount}</b><small>visible in student classrooms</small></article></div><div class="role-columns"><section class="role-panel"><div class="role-section-head"><div><span class="eyebrow">TEACHING PLANNER</span><h2>Today’s schedule</h2></div><span>${dateText(`${today}T12:00`)}</span></div><div class="role-events">${eventRows}</div><div class="role-section-head role-next-head"><div><span class="eyebrow">COMING UP</span><h2>Upcoming classes & deadlines</h2></div></div><div class="role-events">${nextRows}</div></section><section class="role-panel"><div class="role-section-head"><div><span class="eyebrow">TEACHER STUDIO</span><h2>Post to your students</h2></div></div><div class="role-upload-actions"><button data-publish="lecture"><i>▤</i><span><b>Lecture notes</b><small>Upload and share a PDF</small></span><em>→</em></button><button data-publish="test"><i>◉</i><span><b>Tests & quizzes</b><small>Post questions and an answer key</small></span><em>→</em></button><button data-publish="coding"><i>⌘</i><span><b>Coding problems</b><small>Students solve them in the lab</small></span><em>→</em></button><button data-publish="flashcards"><i>▱</i><span><b>Flashcards</b><small>Build a revision deck for your class</small></span><em>→</em></button></div><div class="role-section-head role-planner-head"><div><span class="eyebrow">SHARED TIMETABLE</span><h2>Add a schedule item</h2></div></div><form id="roleEventForm" class="role-event-form"><label>EVENT TYPE<select name="kind"><option value="class">Class</option><option value="break">Break</option><option value="test">Test</option><option value="exam">Exam</option><option value="assignment">Assignment deadline</option></select></label><label>CLASS / EVENT TITLE<input name="title" required maxlength="120" placeholder="e.g. Data Structures"></label><label>COURSE<input name="course" maxlength="100" placeholder="e.g. CSE202"></label><div class="role-date-pair"><label>DATE<input name="date" type="date" value="${date}" required></label><label>START TIME<input name="start" type="time" required></label></div><label>END TIME (OPTIONAL)<input name="end" type="time"></label><label>ROOM / NOTES<input name="details" maxlength="1200" placeholder="Room, break details, or instructions"></label><button class="primary">ADD TO PLANNER →</button><small id="roleEventError" class="role-form-note"></small></form></section></div>`, 'TEACHER');
    bindCommon(); bindSchedule(); host.querySelectorAll('[data-publish]').forEach(button => button.onclick = () => window.JarvisLms.publish(button.dataset.publish));
  }
  function upcomingDeadlines() {
    return events.filter(event => ['exam', 'test', 'assignment'].includes(event.kind) && new Date(event.start_at).getTime() >= Date.now() && dayGap(event.start_at) >= 0).map(event => ({ ...event, days: dayGap(event.start_at) })).sort((a,b) => a.days - b.days);
  }
  function reminders() {
    const imminent = upcomingDeadlines().filter(event => event.kind === 'exam' ? event.days <= 7 : event.kind === 'assignment' ? event.days <= 1 : event.days <= 1);
    imminent.forEach(event => {
      const key = `jarvis.reminder.${event.id}.${localDate(new Date())}`;
      if (!localStorage.getItem(key) && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(event.kind === 'exam' ? 'Exam in one week or less' : event.kind === 'assignment' ? 'Assignment deadline reminder' : 'Test coming up', { body: `${event.title} · ${event.course || 'Campus'} · ${event.days === 0 ? 'Today' : `in ${event.days} day${event.days === 1 ? '' : 's'}`}`, tag: key });
        localStorage.setItem(key, '1');
      }
    });
    return imminent;
  }
  function renderStudent() {
    const today = localDate(new Date()), daySchedule = events.filter(event => ['class', 'break'].includes(event.kind) && event.start_at.slice(0, 10) >= today).slice(0, 8);
    const dueSoon = upcomingDeadlines().slice(0, 5), alertEvents = reminders();
    const alerts = alertEvents.length ? alertEvents.map(event => `<div class="role-reminder ${event.days === 0 ? 'is-today' : ''}"><span>⏱</span><div><b>${event.kind === 'exam' ? 'Exam reminder' : event.kind === 'assignment' ? 'Assignment due soon' : 'Test reminder'}</b><small>${safe(event.title)} · ${event.days === 0 ? 'today' : `in ${event.days} day${event.days === 1 ? '' : 's'}`}</small></div></div>`).join('') : '<div class="role-empty">No deadlines need attention right now. Exam reminders appear a week ahead; assignment reminders appear the day before.</div>';
    host.innerHTML = dashboardFrame(`<div class="role-stats"><article class="role-stat"><span>UPCOMING CLASSES</span><b>${daySchedule.filter(e => e.kind === 'class').length}</b><small>from the shared teacher timetable</small></article><article class="role-stat"><span>UPCOMING DEADLINES</span><b>${dueSoon.length}</b><small>tests, exams, and assignments</small></article><article class="role-stat"><span>TEACHER POSTS</span><b>${postCount}</b><small>notes, tests, and coding labs</small></article></div><div class="role-columns"><section class="role-panel"><div class="role-section-head"><div><span class="eyebrow">YOUR CLASS DAY</span><h2>Classes & breaks</h2></div><span>${dateText(`${today}T12:00`)}</span></div><div class="role-events">${daySchedule.map(event => eventCard(event)).join('') || '<div class="role-empty">Your teachers’ timetable will show up here when they add a class or break.</div>'}</div><div class="role-section-head role-next-head"><div><span class="eyebrow">EXAM & ASSIGNMENT RADAR</span><h2>Coming up</h2></div><button class="role-notify" id="enableReminders">${'Notification' in window ? (Notification.permission === 'granted' ? '✓ BROWSER REMINDERS ON' : 'ENABLE BROWSER REMINDERS') : 'IN-APP REMINDERS ON'}</button></div><div class="role-reminder-list">${alerts}</div><div class="role-events role-deadlines">${dueSoon.map(event => eventCard(event)).join('') || '<div class="role-empty">Your teachers have not posted an exam, test, or assignment deadline yet.</div>'}</div></section><section class="role-panel"><div class="role-section-head"><div><span class="eyebrow">LEARNING COMMONS</span><h2>From your teachers</h2></div></div><p class="role-panel-copy">Open teacher PDF notes, tests, code challenges, and revision cards from one place.</p><div class="role-upload-actions"><button data-open-lms><i>▤</i><span><b>Classroom posts</b><small>${postCount} notes, assessments & coding labs</small></span><em>→</em></button><button data-open-flash><i>▱</i><span><b>Flashcard revision</b><small>Flip through teacher-created decks</small></span><em>→</em></button><button data-open-campus><i>◫</i><span><b>My Student Hub</b><small>Personal records and study tools</small></span><em>→</em></button></div><div class="role-section-head role-next-head"><div><span class="eyebrow">REMINDER RULES</span><h2>Stay ahead</h2></div></div><p class="role-panel-copy">JARVIS flags exams starting 7 days before and assignments starting 1 day before. Reminders remain visible here while they are upcoming. Enable browser notifications above if you want a notification while this page is open.</p></section></div>`, 'STUDENT');
    bindCommon(); bindReminders(); mountStudyNow();
  }
  function mountStudyNow() {
    const panel = host.querySelector('.role-columns > .role-panel:last-child');
    if (!panel) return;
    const priority = upcomingDeadlines()[0];
    const nextStep = priority ? `Start <strong>${safe(priority.title)}</strong> for 15 minutes. It is ${priority.days === 0 ? 'due today' : `due in ${priority.days} day${priority.days === 1 ? '' : 's'}`}.` : 'Pick one topic for a 15-minute study block, or ask JARVIS aloud what to work on next.';
    panel.insertAdjacentHTML('afterbegin', `<section class="card pick role-study-widget"><div class="head">⚡ &nbsp; WHAT SHOULD I DO NOW? <small>JARVIS PICK</small></div><p>${nextStep}</p><div class="role-study-actions"><button class="primary" data-study-start>MAKE IT MY NEXT TASK</button><button class="secondary role-study-voice" data-study-voice type="button">🎙 &nbsp; ASK JARVIS BY VOICE</button></div><div class="role-study-controls"><label>STUDY TOPIC<input id="studyTopic" maxlength="120" placeholder="e.g. photosynthesis, recursion"></label><label>LEVEL<select id="studyDifficulty"><option>Beginner</option><option selected>Intermediate</option><option>Advanced</option></select></label></div><div class="role-study-actions"><button class="primary" data-study-mode="quiz">◉ &nbsp; CREATE A QUIZ</button><button class="secondary" data-study-mode="flashcards">▱ &nbsp; GENERATE FLASHCARDS</button></div><p class="role-study-caption">AI-generated with Ollama on this computer · Offline voice replies and study prompts are available without a model.</p><div id="studyOutput" class="role-study-output" aria-live="polite"></div></section>`);
    panel.querySelectorAll('[data-study-mode]').forEach(button => button.onclick = () => generateStudy(button.dataset.studyMode));
    const voiceButton = panel.querySelector('[data-study-voice]');
    voiceButton?.parentElement.insertAdjacentHTML('afterend', '<div id="studyVoiceReply" class="role-empty" aria-live="polite" hidden></div>');
    const voiceReply = document.getElementById('studyVoiceReply');
    window.JarvisStudyVoiceCleanup?.();
    const showHeardQuestion = event => { if (voiceReply?.isConnected) { voiceReply.hidden = false; voiceReply.textContent = `I heard: “${event.detail.question}” · JARVIS is preparing a reply…`; } };
    const showSpokenAnswer = event => { if (voiceReply?.isConnected) { voiceReply.hidden = false; voiceReply.textContent = `JARVIS: ${event.detail.answer}`; } };
    window.addEventListener('jarvis-voice-transcript', showHeardQuestion);
    window.addEventListener('jarvis-ai-answer', showSpokenAnswer);
    window.JarvisStudyVoiceCleanup = () => { window.removeEventListener('jarvis-voice-transcript', showHeardQuestion); window.removeEventListener('jarvis-ai-answer', showSpokenAnswer); };
    panel.querySelector('[data-study-voice]')?.addEventListener('click', event => window.JarvisVoiceChat?.listen(event.currentTarget));
    panel.querySelector('[data-study-start]')?.addEventListener('click', () => {
      const topic = document.getElementById('studyTopic')?.value.trim();
      const prompt = priority ? `What should I do now? Help me start ${priority.title} with one practical 15-minute first step. It is due ${priority.days === 0 ? 'today' : `in ${priority.days} day${priority.days === 1 ? '' : 's'}`}.` : topic ? `What should I do now? Help me start studying ${topic} with one practical 15-minute first step.` : 'What should I do now? Pick one practical 15-minute study task for me and tell me why it should come first.';
      window.JarvisVoiceChat?.ask(prompt);
    });
  }
  function parseModelJSON(answer, key) {
    let text = String(answer || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = text.indexOf('{'), end = text.lastIndexOf('}');
    if (start >= 0 && end > start) text = text.slice(start, end + 1);
    const data = JSON.parse(text);
    if (!Array.isArray(data[key]) || !data[key].length) throw new Error('The AI returned an empty study set. Please try again.');
    return data[key];
  }
  function offlinePrompts(topic, mode) {
    if (mode === 'quiz') return [
      { question: `In your own words, define ${topic}.`, choices: [], answerHint: 'Use a concise definition from your lecture notes.' },
      { question: `Name two important ideas or parts of ${topic}.`, choices: [], answerHint: 'Check your notes for the key terms and explain how they relate.' },
      { question: `Give a real example where ${topic} is useful.`, choices: [], answerHint: 'Connect one class example to a practical situation.' },
      { question: `What is one common misunderstanding about ${topic}?`, choices: [], answerHint: 'Review the distinctions emphasized in class.' },
      { question: `How would you explain ${topic} to a classmate?`, choices: [], answerHint: 'Give a short explanation and support it with an example.' },
    ];
    return [
      { front: `Define ${topic}.`, back: 'Write a one-sentence definition from your class notes.' },
      { front: `What are two key ideas in ${topic}?`, back: 'Name two key ideas from the topic and say how they connect.' },
      { front: `Give an example of ${topic}.`, back: 'Use a worked example or real-world case from your course.' },
      { front: `What is a common mistake when learning ${topic}?`, back: 'Check your notes for a misconception or step students often miss.' },
      { front: `How would you explain ${topic} to a beginner?`, back: 'Use plain language, then give one short example.' },
    ];
  }
  async function generateStudy(mode) {
    const topicInput = document.getElementById('studyTopic'), output = document.getElementById('studyOutput');
    const topic = topicInput?.value.trim().slice(0, 120), difficulty = document.getElementById('studyDifficulty')?.value || 'Intermediate';
    if (!topic) { topicInput?.focus(); output.textContent = 'Enter a topic first.'; return; }
    const button = host.querySelector(`[data-study-mode="${mode}"]`), original = button.textContent;
    host.querySelectorAll('[data-study-mode]').forEach(item => item.disabled = true);
    button.textContent = 'PREPARING…'; output.innerHTML = '<div class="role-empty">Checking for your local Ollama model…</div>';
    let questionsOrCards, isOffline = false;
    try {
      const status = await fetch('/api/status').then(response => response.json()), local = status.providers?.local;
      if (local?.available && local.models?.length) {
        const response = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: mode, question: `Topic: ${topic}\nDifficulty: ${difficulty}\nMake this useful for a university student.`, provider: 'local', model: local.models[0] }) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Your Ollama model could not generate this study set.');
        questionsOrCards = parseModelJSON(result.answer, mode === 'quiz' ? 'questions' : 'cards');
      } else { isOffline = true; questionsOrCards = offlinePrompts(topic, mode); }
    } catch (error) {
      isOffline = true; questionsOrCards = offlinePrompts(topic, mode);
    }
    if (mode === 'quiz') renderGeneratedQuiz(topic, questionsOrCards, isOffline);
    else renderGeneratedCards(topic, questionsOrCards, isOffline);
    host.querySelectorAll('[data-study-mode]').forEach(item => item.disabled = false);
    const activeButton = host.querySelector(`[data-study-mode="${mode}"]`); if (activeButton) activeButton.textContent = original;
  }
  function renderGeneratedQuiz(topic, questions, offline) {
    const output = document.getElementById('studyOutput');
    output.innerHTML = `<div class="study-result-head"><span class="lms-kind ${offline ? 'kind-test' : 'kind-lecture'}">${offline ? 'OFFLINE STUDY PROMPTS' : 'OLLAMA · GENERATED QUIZ'}</span><b>${safe(topic)}</b></div><form id="generatedQuiz">${questions.map((question, i) => `<fieldset><legend>${i + 1}. ${safe(question.question)}</legend>${Array.isArray(question.choices) && question.choices.length ? `${question.choices.map(choice => `<label class="lms-choice"><input type="radio" name="gq${i}" value="${safe(choice)}"><span>${safe(choice)}</span></label>`).join('')}<small class="study-hint" data-hint="${i}" hidden>${safe(question.answer ? `Answer: ${question.answer}. ` : '')}${safe(question.explanation || '')}</small>` : `<textarea class="lms-field" name="gq${i}" rows="2" placeholder="Write your answer"></textarea><small class="study-hint" data-hint="${i}" hidden>${safe(question.answerHint || 'Review this answer against your notes.')}</small>`}</fieldset>`).join('')}<div class="study-result-actions"><button class="primary" type="submit">CHECK MY ANSWERS</button><span id="generatedScore" aria-live="polite"></span></div></form>`;
    document.getElementById('generatedQuiz').onsubmit = event => {
      event.preventDefault(); const form = new FormData(event.currentTarget); let score = 0, scored = 0;
      questions.forEach((question, i) => {
        if (Array.isArray(question.choices) && question.choices.length && question.answer) { scored++; if (String(form.get(`gq${i}`) || '').trim().toLowerCase() === String(question.answer).trim().toLowerCase()) score++; }
        const hint = output.querySelector(`[data-hint="${i}"]`); if (hint) hint.hidden = false;
      });
      document.getElementById('generatedScore').textContent = scored ? `${score} / ${scored} correct · review the answer cues below.` : 'Answers saved for your self-review. Compare them with your class notes.';
    };
  }
  function renderGeneratedCards(topic, cards, offline) {
    const output = document.getElementById('studyOutput'); let index = 0, flipped = false;
    const draw = () => {
      const card = cards[index];
      output.innerHTML = `<div class="study-result-head"><span class="lms-kind ${offline ? 'kind-test' : 'kind-lecture'}">${offline ? 'OFFLINE STUDY PROMPTS' : 'OLLAMA · GENERATED FLASHCARDS'}</span><b>${safe(topic)}</b></div><div class="study-card-count">CARD ${index + 1} / ${cards.length}</div><button class="study-generated-card ${flipped ? 'flipped' : ''}" id="generatedCard"><small>${flipped ? 'ANSWER' : 'QUESTION'} · CLICK TO FLIP</small><strong>${safe(flipped ? card.back : card.front)}</strong></button><div class="study-card-controls"><button class="secondary" id="studyPrev">← PREVIOUS</button><button class="secondary" id="studyFlip">${flipped ? 'SHOW QUESTION' : 'REVEAL ANSWER'}</button><button class="secondary" id="studyNext">NEXT →</button></div><p class="study-note">${offline ? 'Offline prompts are study cues, not AI-generated factual answers.' : 'Generated by the Ollama model running on this computer.'}</p>`;
      const flip = () => { flipped = !flipped; draw(); };
      document.getElementById('generatedCard').onclick = flip; document.getElementById('studyFlip').onclick = flip;
      document.getElementById('studyPrev').onclick = () => { index = (index - 1 + cards.length) % cards.length; flipped = false; draw(); };
      document.getElementById('studyNext').onclick = () => { index = (index + 1) % cards.length; flipped = false; draw(); };
    };
    draw();
  }
  function bindCommon() {
    host.querySelectorAll('[data-open-lms]').forEach(button => button.onclick = () => window.JarvisLms?.open());
    host.querySelectorAll('[data-open-campus]').forEach(button => button.onclick = () => document.getElementById('campusLaunch')?.click());
    host.querySelectorAll('[data-open-flash]').forEach(button => button.onclick = () => { window.JarvisLms?.open(); document.querySelector('#lmsOverlay [data-view="flashcards"]')?.click(); });
  }
  function bindReminders() {
    const button = document.getElementById('enableReminders'); if (!button || !('Notification' in window) || Notification.permission === 'granted') return;
    button.onclick = async () => { const permission = await Notification.requestPermission(); button.textContent = permission === 'granted' ? '✓ BROWSER REMINDERS ON' : 'IN-APP REMINDERS ON'; if (permission === 'granted') { const pending = reminders(); if (!pending.length) new Notification('JARVIS reminders enabled', { body: 'Upcoming exams and assignments will alert you while this site is open.' }); } };
  }
  function render() { if (!user) return; user.role === 'teacher' ? renderTeacher() : renderStudent(); }
})();
