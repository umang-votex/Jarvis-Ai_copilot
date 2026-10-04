(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  let currentUser = null, items = [], decks = [], active = null, answers = {}, runResult = null, flashIndex = 0, flashRevealed = false;
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const toast = message => { const el = $('#toast'); if (el) { el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2500); } };
  const overlay = document.createElement('div');
  overlay.id = 'lmsOverlay';
  overlay.className = 'lms-overlay';
  overlay.innerHTML = `<section class="lms-shell"><header class="lms-header"><div><div class="eyebrow">J.A.R.V.I.S. // CAMPUS</div><h1>Learning <span>Commons</span></h1><p>Lectures, assessments, flashcards, and a coding lab in one classroom.</p></div><div class="lms-tools"><span id="lmsIdentity" class="lms-identity"></span><button class="secondary" id="lmsClose">← BACK TO JARVIS</button></div></header><nav class="lms-nav"><button data-view="all" class="active">CLASSROOM</button><button data-view="lecture">LECTURE NOTES</button><button data-view="test">TESTS</button><button data-view="coding">CODING LAB</button><button data-view="flashcards">FLASHCARDS</button><button id="lmsPublish" class="lms-publish" hidden>＋ TEACHER STUDIO</button></nav><main class="lms-main"><section id="lmsNotice" class="lms-notice"></section><section id="lmsContent"></section></main></section>`;
  document.body.append(overlay);
  const content = $('#lmsContent', overlay), notice = $('#lmsNotice', overlay);
  function open() { overlay.classList.add('open'); load(); }
  function close() { overlay.classList.remove('open'); active = null; }
  $('#lmsClose', overlay).onclick = close;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('open')) close(); });
  document.addEventListener('jarvis-auth-changed', event => { currentUser = event.detail || null; if (currentUser) load(); });
  $('#campusLaunch')?.insertAdjacentHTML('afterend', '<button class="campus-launch" id="lmsLaunch" type="button">▤ CLASSROOM</button>');
  $('#lmsLaunch')?.addEventListener('click', open);
  overlay.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { overlay.querySelectorAll('[data-view]').forEach(item => item.classList.toggle('active', item === button)); active = null; render(button.dataset.view); }));
  $('#lmsPublish', overlay).onclick = () => publishForm('lecture');
  async function load() {
    try {
      const [response, flashResponse] = await Promise.all([fetch('/api/lms/items'), fetch('/api/lms/flashcards')]); const data = await response.json(), flashData = await flashResponse.json();
      if (!response.ok) throw new Error(data.error || 'Could not load classroom.');
      if (!flashResponse.ok) throw new Error(flashData.error || 'Could not load flashcards.');
      currentUser = { ...(currentUser || {}), role: data.role, name: data.name };
      items = data.items || [];
      decks = flashData.decks || [];
      $('#lmsIdentity', overlay).textContent = `${currentUser.role.toUpperCase()} · ${currentUser.name}`;
      $('#lmsPublish', overlay).hidden = currentUser.role !== 'teacher';
      notice.textContent = currentUser.role === 'teacher' ? 'Teacher studio is ready. Publish class materials, assessments, coding problems, and flashcards.' : 'Your classroom is ready. Open a resource, take a test, study flashcards, or solve a coding challenge.';
      render(overlay.querySelector('[data-view].active')?.dataset.view || 'all');
    } catch (error) { notice.textContent = error.message; content.innerHTML = '<article class="lms-empty">Sign in to access the classroom.</article>'; }
  }
  function render(filter = 'all') {
    if (active) return renderDetail(active);
    if (filter === 'flashcards') return renderFlashcards();
    const shown = items.filter(item => filter === 'all' || item.kind === filter);
    if (!shown.length) { content.innerHTML = `<div class="lms-empty"><div class="lms-empty-icon">✳</div><h2>No classroom posts yet</h2><p>${currentUser?.role === 'teacher' ? 'Use Teacher Studio to add your first PDF, test, or coding problem.' : 'Your teachers’ new notes, tests, and code challenges will appear here.'}</p>${currentUser?.role === 'teacher' ? '<button class="primary" id="emptyPublish">＋ CREATE A CLASS POST</button>' : ''}</div>`; $('#emptyPublish')?.addEventListener('click', () => publishForm('lecture')); return; }
    content.innerHTML = `<div class="lms-summary"><div><span class="eyebrow">CAMPUS LEARNING SPACE</span><h2>${filter === 'all' ? 'Your classes, in one place.' : filter === 'coding' ? 'Build. Run. Learn.' : filter === 'test' ? 'Check what you know.' : 'Learn at your own pace.'}</h2></div><span class="lms-count">${shown.length} POST${shown.length === 1 ? '' : 'S'}</span></div><div class="lms-grid">${shown.map(item => `<article class="lms-card" data-item="${safe(item.id)}"><div class="lms-card-top"><span class="lms-kind kind-${safe(item.kind)}">${item.kind === 'coding' ? '⌘ CODING LAB' : item.kind === 'test' ? '◉ ASSESSMENT' : '▤ LECTURE PDF'}</span><span class="lms-card-date">${new Date(item.created_at + (item.created_at.includes('Z') ? '' : 'Z')).toLocaleDateString()}</span></div><h3>${safe(item.title)}</h3><div class="lms-course">${safe(item.course)} · ${safe(item.teacher_name || 'Teacher')}</div><p>${safe(item.description || (item.kind === 'lecture' ? item.file_name : item.kind === 'test' ? `${item.content.questions?.length || 0} questions` : `${item.content.tests?.length || 0} test cases`))}</p><button class="secondary lms-open" data-open="${safe(item.id)}">${item.kind === 'lecture' ? 'OPEN NOTES ↗' : item.kind === 'test' ? 'START TEST →' : 'OPEN CODING LAB →'}</button></article>`).join('')}</div>`;
    content.querySelectorAll('[data-open]').forEach(button => button.onclick = () => { active = items.find(item => item.id === button.dataset.open); answers = {}; runResult = null; renderDetail(active); });
  }
  function renderFlashcards() {
    if (!decks.length) { content.innerHTML = `<div class="lms-empty"><div class="lms-empty-icon">▱</div><h2>No flashcard decks yet</h2><p>${currentUser?.role === 'teacher' ? 'Create a deck in Teacher Studio so students can review key ideas.' : 'Teacher-created flashcard decks will appear here for quick revision.'}</p>${currentUser?.role === 'teacher' ? '<button class="primary" id="emptyFlashcards">＋ CREATE A FLASHCARD DECK</button>' : ''}</div>`; $('#emptyFlashcards')?.addEventListener('click', () => publishForm('flashcards')); return; }
    content.innerHTML = `<div class="lms-summary"><div><span class="eyebrow">RECALL PRACTICE</span><h2>Flashcards help it stick.</h2></div><span class="lms-count">${decks.length} DECK${decks.length === 1 ? '' : 'S'}</span></div><div class="lms-grid">${decks.map(deck => `<article class="lms-card"><div class="lms-card-top"><span class="lms-kind kind-coding">▱ FLASHCARDS</span><span class="lms-card-date">${deck.cards.length} CARDS</span></div><h3>${safe(deck.title)}</h3><div class="lms-course">${safe(deck.course)} · ${safe(deck.teacher_name)}</div><p>${safe(deck.description || 'Flip through the cards and test your recall.')}</p><button class="secondary lms-open" data-deck="${safe(deck.id)}">STUDY THIS DECK →</button></article>`).join('')}</div>`;
    content.querySelectorAll('[data-deck]').forEach(button => button.onclick = () => { active = decks.find(deck => deck.id === button.dataset.deck); flashIndex = 0; flashRevealed = false; renderDeck(); });
  }
  function renderDeck() {
    const deck = active, card = deck?.cards?.[flashIndex];
    if (!deck || !card) return renderFlashcards();
    content.innerHTML = `<button class="lms-back" id="deckBack">← ALL FLASHCARD DECKS</button><div class="lms-detail-head"><span class="lms-kind kind-coding">▱ FLASHCARDS · ${safe(deck.course)}</span><h2>${safe(deck.title)}</h2><p>${safe(deck.description || `Created by ${deck.teacher_name}.`)}</p></div><div class="flash-study"><div class="flash-progress">CARD ${flashIndex + 1} / ${deck.cards.length}</div><button class="flash-card ${flashRevealed ? 'revealed' : ''}" id="flashCard" aria-label="Flip flashcard"><span class="eyebrow">${flashRevealed ? 'ANSWER' : 'QUESTION'} · CLICK TO FLIP</span><strong>${safe(flashRevealed ? card.back : card.front)}</strong></button><div class="flash-controls"><button class="secondary" id="flashPrev">← PREVIOUS</button><button class="primary" id="flashFlip">${flashRevealed ? 'SHOW QUESTION' : 'REVEAL ANSWER'}</button><button class="secondary" id="flashNext">NEXT →</button></div></div>`;
    const flip = () => { flashRevealed = !flashRevealed; renderDeck(); };
    $('#deckBack').onclick = () => { active = null; renderFlashcards(); };
    $('#flashCard').onclick = flip; $('#flashFlip').onclick = flip;
    $('#flashPrev').onclick = () => { flashIndex = (flashIndex - 1 + deck.cards.length) % deck.cards.length; flashRevealed = false; renderDeck(); };
    $('#flashNext').onclick = () => { flashIndex = (flashIndex + 1) % deck.cards.length; flashRevealed = false; renderDeck(); };
  }
  function renderDetail(item) {
    if (!item) return render();
    if (item.kind === 'lecture') content.innerHTML = `<button class="lms-back" id="detailBack">← ALL CLASSROOM POSTS</button><div class="lms-detail-head"><span class="lms-kind kind-lecture">▤ LECTURE PDF · ${safe(item.course)}</span><h2>${safe(item.title)}</h2><p>${safe(item.description)}</p><small>POSTED BY ${safe(item.teacher_name || 'TEACHER')}</small></div><iframe class="lms-pdf" title="${safe(item.title)}" src="/api/lms/items/${safe(item.id)}/file"></iframe><a class="secondary lms-download" href="/api/lms/items/${safe(item.id)}/file" download="${safe(item.file_name || 'lecture.pdf')}">DOWNLOAD PDF ↓</a>`;
    if (item.kind === 'test') content.innerHTML = `<button class="lms-back" id="detailBack">← ALL CLASSROOM POSTS</button><div class="lms-detail-head"><span class="lms-kind kind-test">◉ ASSESSMENT · ${safe(item.course)}</span><h2>${safe(item.title)}</h2><p>${safe(item.description)}</p></div><form id="testForm" class="lms-assessment">${(item.content.questions || []).map((question, index) => `<fieldset><legend><b>${index + 1}.</b> ${safe(question.question)}</legend>${(question.choices || []).map((choice, choiceIndex) => `<label class="lms-choice"><input type="radio" name="q${index}" value="${safe(choice)}" ${answers[index] === choice ? 'checked' : ''}><span>${safe(choice)}</span></label>`).join('')}${!question.choices?.length ? `<input class="lms-field" name="q${index}" value="${safe(answers[index] || '')}" placeholder="Your answer">` : ''}</fieldset>`).join('')}<div class="lms-form-actions"><button class="primary">SUBMIT TEST →</button><span class="lms-result" id="testResult"></span></div></form>`;
    if (item.kind === 'coding') content.innerHTML = `<button class="lms-back" id="detailBack">← ALL CLASSROOM POSTS</button><div class="lms-detail-head"><span class="lms-kind kind-coding">⌘ CODING LAB · ${safe(item.course)}</span><h2>${safe(item.title)}</h2><p>${safe(item.description)}</p></div><div class="lms-code-layout"><section class="lms-code-instructions"><div class="eyebrow">TASK</div><p>Complete <code>${safe(item.content.functionName)}(...)</code> and run the examples below. You can use JavaScript in this browser-based lab.</p><div class="lms-examples"><div class="eyebrow">EXAMPLE TESTS</div>${item.content.tests.map((test, i) => `<div class="lms-example"><small>TEST ${String(i + 1).padStart(2, '0')}</small><code>${safe(JSON.stringify(test.input))}</code><span>→ ${safe(JSON.stringify(test.expected))}</span></div>`).join('')}</div><div class="lms-result" id="codeResult">${runResult || 'Your code runs inside a restricted browser sandbox.'}</div></section><section class="lms-editor"><div class="lms-editor-bar"><span>● &nbsp; JAVASCRIPT EDITOR</span><button class="secondary" id="runCode">▶ RUN TESTS</button></div><textarea id="codeInput" spellcheck="false" aria-label="JavaScript solution">${safe(item.content.starterCode || `function ${item.content.functionName}(value) {\n  // Write your solution here\n  return value;\n}`)}</textarea><div class="lms-form-actions"><span class="lms-editor-hint">Results are checked in your browser.</span><button class="primary" id="submitCode">SUBMIT SOLUTION →</button></div></section></div>`;
    $('#detailBack')?.addEventListener('click', () => { active = null; render(overlay.querySelector('[data-view].active')?.dataset.view || 'all'); });
    $('#testForm')?.addEventListener('submit', async event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      (item.content.questions || []).forEach((_, i) => answers[i] = String(form.get(`q${i}`) || ''));
      const result = await submitAttempt(item.id, { answers });
      if (result) $('#testResult').textContent = `Saved · ${result.score} / ${result.maxScore} correct`;
    });
    $('#runCode')?.addEventListener('click', runCode);
    $('#submitCode')?.addEventListener('click', async () => {
      if (!runResult) await runCode();
      if (runResult) { const passed = Number(runResult.match(/(\d+) \/ \d+ passed/)?.[1] || 0); const saved = await submitAttempt(item.id, { code: $('#codeInput').value, passed }); if (saved) toast(`Solution saved · ${saved.score}/${saved.maxScore} tests passed`); }
    });
  }
  async function submitAttempt(id, response) {
    try { const res = await fetch(`/api/lms/items/${id}/attempts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response }) }); const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Could not save submission.'); return data; }
    catch (error) { toast(error.message); return null; }
  }
  async function runCode() {
    const item = active, code = $('#codeInput')?.value || ''; if (!item || code.length > 10000) return toast('Keep the solution under 10,000 characters.');
    const result = $('#codeResult'); if (result) result.textContent = 'Running tests in a restricted browser frame…';
    runResult = null;
    const frame = document.createElement('iframe'); frame.sandbox = 'allow-scripts'; frame.title = 'Restricted code execution frame'; frame.className = 'lms-sandbox';
    const id = `${Date.now()}-${Math.random()}`;
    const receive = event => { if (event.source !== frame.contentWindow || event.data?.id !== id) return; window.removeEventListener('message', receive); clearTimeout(timeout); frame.remove(); runResult = `${event.data.passed} / ${event.data.total} passed${event.data.error ? ` · ${event.data.error}` : ''}`; if ($('#codeResult')) $('#codeResult').textContent = runResult; };
    const timeout = setTimeout(() => { window.removeEventListener('message', receive); frame.remove(); runResult = 'Timed out · check for an infinite loop.'; if ($('#codeResult')) $('#codeResult').textContent = runResult; }, 2500);
    window.addEventListener('message', receive); document.body.append(frame);
    frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; form-action 'none'; base-uri 'none'"><script>addEventListener('message',e=>{const {id,code,name,tests}=e.data;let passed=0,error='';try{const fn=new Function(code+'\\n;return (typeof '+name+'===\"function\"?'+name+':null)')();if(typeof fn!=='function')throw Error('Define the requested function: '+name);for(const t of tests){try{const got=fn(...t.input);if(JSON.stringify(got)===JSON.stringify(t.expected))passed++}catch(x){error=x.message;}}}catch(x){error=x.message}parent.postMessage({id,passed,total:tests.length,error},'*')});<\/script>`;
    frame.addEventListener('load', () => frame.contentWindow.postMessage({ id, code, name: item.content.functionName, tests: item.content.tests }, '*'), { once: true });
  }
  function publishForm(kind = 'lecture') {
    active = null; content.innerHTML = `<div class="lms-publisher"><button class="lms-back" id="publisherBack">← CLASSROOM</button><div class="eyebrow">TEACHER STUDIO // CREATE A POST</div><h2>Publish to your class.</h2><p>Students will see this in their JARVIS Learning Commons.</p><div class="lms-type-select"><button data-kind="lecture" class="${kind === 'lecture' ? 'active' : ''}">▤ LECTURE PDF</button><button data-kind="test" class="${kind === 'test' ? 'active' : ''}">◉ TEST</button><button data-kind="coding" class="${kind === 'coding' ? 'active' : ''}">⌘ CODING PROBLEM</button><button data-kind="flashcards" class="${kind === 'flashcards' ? 'active' : ''}">▱ FLASHCARDS</button></div><form id="publishForm" class="lms-publish-form"><label>POST TITLE<input class="lms-field" name="title" required maxlength="120" placeholder="e.g. Introduction to databases"></label><label>COURSE<input class="lms-field" name="course" required maxlength="100" placeholder="e.g. Database Systems"></label><label>INSTRUCTIONS / DESCRIPTION<textarea class="lms-field" name="description" rows="3" placeholder="What should students know before they begin?"></textarea></label><div id="kindFields"></div><div class="lms-form-actions"><span class="lms-editor-hint">Posts are saved in this JARVIS database.</span><button class="primary" type="submit">PUBLISH TO CLASS →</button></div><div id="publishError" class="lms-result"></div></form></div>`;
    $('#publisherBack').onclick = () => render();
    content.querySelectorAll('[data-kind]').forEach(button => button.onclick = () => publishForm(button.dataset.kind));
    const fields = $('#kindFields');
    fields.innerHTML = kind === 'lecture' ? `<label class="lms-upload">LECTURE PDF<input type="file" name="pdf" accept="application/pdf,.pdf" required><small>PDF up to 10 MB</small></label>` : kind === 'test' ? `<label>TEST QUESTIONS <small>JSON with question, choices, and answer fields.</small><textarea class="lms-field lms-json" name="questions" required>{"questions":[{"question":"Which data type stores whole numbers?","choices":["integer","boolean","string"],"answer":"integer"}]}</textarea></label><label>OPTIONAL PDF ATTACHMENT<input class="lms-field" type="file" name="pdf" accept="application/pdf,.pdf"></label>` : kind === 'coding' ? `<label>FUNCTION NAME<input class="lms-field" name="functionName" required value="sumNumbers" placeholder="sumNumbers"></label><label>STARTER CODE<textarea class="lms-field lms-json" name="starterCode" rows="5">function sumNumbers(a, b) {\n  // Return the sum\n  return a + b;\n}</textarea></label><label>TEST CASES <small>JSON array; each case has input (arguments) and expected result.</small><textarea class="lms-field lms-json" name="tests" required>[{"input":[2,3],"expected":5},{"input":[-1,1],"expected":0}]</textarea></label>` : `<label>FLASHCARDS <small>JSON array with front and back for each card. Add 2 or more.</small><textarea class="lms-field lms-json" name="cards" required>[{"front":"What does CPU stand for?","back":"Central Processing Unit"},{"front":"What is RAM?","back":"Temporary working memory used by running programs"}]</textarea></label>`;
    $('#publishForm').onsubmit = async event => {
      event.preventDefault(); const form = event.currentTarget, data = new FormData(form), body = { kind, title: data.get('title'), course: data.get('course'), description: data.get('description'), content: {} }, error = $('#publishError');
      try {
        if (kind === 'lecture' || kind === 'test') {
          const file = data.get('pdf');
          if (kind === 'lecture' && (!file || !file.size)) throw new Error('Choose the lecture PDF first.');
          if (file?.size) { if (file.size > 10 * 1024 * 1024 || file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) throw new Error('Choose a PDF smaller than 10 MB.'); body.fileName = file.name; body.mimeType = 'application/pdf'; body.fileData = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read this PDF.')); reader.readAsDataURL(file); }); }
          if (kind === 'test') { const parsed = JSON.parse(data.get('questions')); if (!Array.isArray(parsed.questions) || !parsed.questions.length) throw new Error('Add at least one question in the JSON.'); body.content = parsed; }
        }
        if (kind === 'coding') { body.content = { functionName: data.get('functionName'), starterCode: data.get('starterCode'), tests: JSON.parse(data.get('tests')) }; }
        if (kind === 'flashcards') body.cards = JSON.parse(data.get('cards'));
        const response = await fetch(kind === 'flashcards' ? '/api/lms/flashcards' : '/api/lms/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not publish this post.');
        toast('Published to your classroom.'); await load();
      } catch (err) { error.textContent = err.message || 'Check your form and try again.'; }
    };
  }
  window.JarvisLms = { open, publish(kind) { overlay.classList.add('open'); publishForm(kind); } };
})();
