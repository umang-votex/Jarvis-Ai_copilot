(() => {
  const link=document.createElement('link');link.rel='stylesheet';link.href='/enhancements.css';document.head.append(link);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,touch=matchMedia('(pointer: coarse)').matches;
  if(reduced||touch)return;
  let queued=false,last;
  document.addEventListener('pointermove',event=>{last=event;if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;const card=last.target.closest?.('.card:not(.hero),.campus-record');if(!card||last.buttons)return;const rect=card.getBoundingClientRect(),x=(last.clientX-rect.left)/rect.width-.5,y=(last.clientY-rect.top)/rect.height-.5;card.style.setProperty('--card-tilt-x',`${Math.max(-2.4,Math.min(2.4,x*4.8))}deg`);card.style.setProperty('--card-tilt-y',`${Math.max(-2.1,Math.min(2.1,-y*4.2))}deg`)})},{passive:true});
  document.addEventListener('pointerout',event=>{const card=event.target.closest?.('.card:not(.hero),.campus-record');if(card&&!card.contains(event.relatedTarget)){card.style.removeProperty('--card-tilt-x');card.style.removeProperty('--card-tilt-y')}},{passive:true});
})();
