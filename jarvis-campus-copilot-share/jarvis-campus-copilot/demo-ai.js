// Keep the tutor usable on a judge's computer without Ollama or a cloud key.
const demoOption=new Option('DEMO · OFFLINE','demo');
byId('aiProvider').add(demoOption);
const realSetStatus=setStatus;
setStatus=data=>{
  const local=data.providers?.local||{available:false,models:[]};
  const cloud=!!data.providers?.openai?.available;
  if(!local.models.length&&!cloud)state.provider='demo';
  realSetStatus(data);
  if(state.provider==='demo'){
    byId('aiProvider').value='demo';
    byId('aiModel').textContent='DEMO · READY';
    byId('aiModel').classList.add('live');
    byId('aiState').textContent='DEMO MODE';
    byId('aiState').classList.add('live');
    byId('aiModelSelect').hidden=true;
    byId('aiPrivacy').textContent='Offline demo responses use this browser only. They are examples, not live AI output.';
    byId('aiSetup').style.display='none';
  }
};
function demoTutorAnswer(action,question,notes,context){
  const clean=String(notes||'').replace(/\s+/g,' ').trim();
  const words=question.toLowerCase().match(/[a-z0-9]{4,}/g)||[];
  const matching=words.find(word=>clean.toLowerCase().includes(word));
  const excerpt=matching?clean.slice(Math.max(0,clean.toLowerCase().indexOf(matching)-110),clean.toLowerCase().indexOf(matching)+420):clean.slice(0,520);
  if(action==='summary')return clean?`OFFLINE STUDY SUMMARY · ${state.file?.name||'uploaded notes'}\n\n${excerpt}${clean.length>excerpt.length?'…':''}\n\nThis is an extractive preview. Connect Ollama or OpenAI for a generated summary.`:'Upload a text-based PDF, TXT, or Markdown file and I can show an extractive preview here. The full summary needs a connected model.';
  if(action==='quiz'){
    if(!clean)return 'Upload your notes to generate a source-based quiz. In offline demo mode I avoid inventing facts or answer keys.';
    const terms=[...new Set((clean.match(/\b[A-Za-z][A-Za-z-]{5,}\b/g)||[]).map(x=>x.toLowerCase()))].slice(0,3);
    return `OFFLINE PRACTICE PROMPT · based on ${state.file?.name||'your notes'}\n\n${terms.map((term,i)=>`${i+1}. Find “${term}” in the notes. Explain its role in one sentence and cite the page or paragraph.`).join('\n\n')}\n\nConnect a model to generate multiple-choice questions and check answers.`;
  }
  if(action==='explain')return clean?`I found a relevant passage in ${state.file?.name||'your notes'}${matching?` for “${matching}”`:''}:\n\n“${excerpt}”\n\nOffline demo can locate and quote matching text. Connect Ollama or OpenAI for a generated explanation.`:'Upload notes first. The offline demo can locate matching passages; a connected model can explain them in plain language.';
  if(action==='plan'||/what should i do|plan my day|next task|focus/.test(question.toLowerCase()))return `DEMO DAY BRIEFING\n\n1. Check the Student Hub for the earliest assignment or exam deadline.\n2. Protect one 25-minute focus block before your next class.\n3. Review the attendance panel for any course near the minimum threshold.\n\nThe dashboard timetable and starter records are fictional examples. Connect Ollama or OpenAI for a personalized plan from your account data.`;
  if(clean&&matching)return `I heard you ask: “${question}”. Here is the passage matching “${matching}” in ${state.file?.name||'your notes'}:\n\n“${excerpt}”\n\nThis offline preview can find relevant text, but it cannot verify or generate a full answer until Ollama is running.`;
  if(/^(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(question.trim().toLowerCase()))return 'Hello! I can hear you. Ollama is unavailable, so I am in offline voice mode. Ask me to plan your study day or upload notes and ask about text in them.';
  if(/what can you do|how can you help|help me|your features/.test(question.toLowerCase()))return 'I can listen to questions, speak replies, help with study notes, make quizzes and flashcards, and plan study time. Ollama is unavailable right now, so generated answers need Ollama; offline mode can still find matching passages in notes and give study prompts.';
  if(clean)return `I heard you ask: “${question}”. I could not find a matching passage in ${state.file?.name||'your notes'}. Ollama is unavailable right now, so I cannot generate a reliable answer. Try asking about a term that appears in the notes, or start Ollama and try again.`;
  return `I heard you ask: “${question}”. Your microphone is working and JARVIS can speak back, but Ollama is unavailable so I cannot generate a reliable answer yet. You can still ask me to plan your study day, or upload notes and ask about text in them. Start Ollama on this computer to enable generated answers.`;
}
const connectedRun=run;
run=async function(action='chat',preset='',options={}){
  if(state.provider!=='demo')return connectedRun(action,preset,options);
  if(state.busy)return;
  const question=preset||byId('aiQuestion').value.trim();
  if(action==='chat'&&!question)return byId('aiQuestion').focus();
  bubble(question||({summary:'Summarize my notes',quiz:'Quiz me on these notes',explain:'Explain the hardest concept in my notes',plan:'Plan my day'}[action]||'Help me study'),'you');
  byId('aiQuestion').value='';state.busy=true;byId('aiSend').disabled=true;document.body.classList.add('ai-loading');
  const wait=bubble('Preparing an offline demo response…','jarvis','loading');
  try{const notes=await notePayload();await new Promise(resolve=>setTimeout(resolve,450));const answer=demoTutorAnswer(action,question,notes.noteText||'',dashboardContext());wait.remove();bubble(answer);if(options.speak||action==='voice')speakAnswer(answer,options.voiceLang)}
  catch(error){wait.remove();bubble(error.message||'I could not read those notes.')}
  finally{state.busy=false;byId('aiSend').disabled=false;document.body.classList.remove('ai-loading')}
};
window.jarvisOfflineVoiceAnswer=async question=>{const notes=await notePayload();return demoTutorAnswer('chat',question,notes.noteText||'',dashboardContext())};
refreshStatus();
