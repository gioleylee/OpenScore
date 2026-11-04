import {useEffect,useRef,useState} from 'react';
import {Play,Pause,Repeat2,Volume2} from 'lucide-react';
import type {Score} from './types';

export function Playback({score,onBeat}:{score:Score;onBeat:(b:number)=>void}) {
 const [playing,setPlaying]=useState(false),[beat,setBeat]=useState(0),[speed,setSpeed]=useState(1),[loop,setLoop]=useState(false),[click,setClick]=useState(false),[a,setA]=useState(0),[b,setB]=useState(4);
 const ctx=useRef<AudioContext|null>(null), current=useRef(0), voices=useRef<OscillatorNode[]>([]), start=useRef({time:0,beat:0}), last=useRef(-1);
 const total=Math.max(4,...score.notes.map(n=>n.onset+n.duration));
 useEffect(()=>{if(!playing)return; const audio=ctx.current!; let timer=0; let scheduled=0;
  const stopVoices=()=>{voices.current.forEach(v=>{try{v.stop();}catch{/* already ended */}});voices.current=[];};
  const reset=()=>{stopVoices();start.current={time:audio.currentTime,beat:current.current};last.current=-1;scheduled=current.current-0.0001;};reset();
  const tick=()=>{const position=start.current.beat+(audio.currentTime-start.current.time)*score.tempo/60*speed;
   if(position>=(loop?b:total)){if(loop){current.current=a;reset();}else{current.current=0;setPlaying(false);setBeat(0);onBeat(0);return;}}
   else current.current=position;
   const horizon=current.current+0.12*score.tempo/60*speed;
   for(const n of score.notes){if((n.onset>scheduled&&n.onset<=horizon)||(scheduled===start.current.beat-0.0001&&n.onset<current.current&&n.onset+n.duration>current.current)){
    if(loop&&n.onset>=b)continue;
    const at=audio.currentTime+Math.max(0,n.onset-current.current)*60/score.tempo/speed;
    const duration=Math.max(0.02,(Math.min(n.onset+n.duration,loop?b:total)-Math.max(n.onset,current.current))*60/score.tempo/speed);
    const osc=audio.createOscillator(),gain=audio.createGain();osc.type='triangle';osc.frequency.value=440*2**((n.pitch-69)/12);gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(n.velocity/127*0.13,at+0.008);gain.gain.exponentialRampToValueAtTime(0.0001,at+duration);osc.connect(gain).connect(audio.destination);osc.start(at);osc.stop(at+duration+0.01);voices.current.push(osc);osc.onended=()=>{voices.current=voices.current.filter(v=>v!==osc);gain.disconnect();};
   }}scheduled=horizon;
   if(click){const next=Math.ceil(current.current);if(next!==last.current&&next<=horizon){last.current=next;const at=audio.currentTime+(next-current.current)*60/score.tempo/speed;const osc=audio.createOscillator(),g=audio.createGain();osc.frequency.value=next%score.settings.numerator===0?1200:800;g.gain.setValueAtTime(0.07,at);g.gain.exponentialRampToValueAtTime(0.001,at+0.04);osc.connect(g).connect(audio.destination);osc.start(at);osc.stop(at+0.05);voices.current.push(osc);osc.onended=()=>{voices.current=voices.current.filter(v=>v!==osc);g.disconnect();};}}
   setBeat(current.current);onBeat(current.current);timer=window.setTimeout(tick,25);
  };tick();return()=>{clearTimeout(timer);stopVoices();};
 },[playing,score,speed,loop,a,b,click,total,onBeat]);
 useEffect(()=>()=>{void ctx.current?.close();},[]);
 async function toggle(){if(!ctx.current)ctx.current=new AudioContext();await ctx.current.resume();setPlaying(x=>!x);}
 return <div className="transport no-print"><div className="transport-top"><button className="play-button" onClick={()=>void toggle()} aria-label={playing?'Pause transcription':'Play transcription'}>{playing?<Pause size={20}/>:<Play size={20}/>}</button><div><strong>Synth playback</strong><small>{(beat*60/score.tempo).toFixed(1)}s / {(total*60/score.tempo).toFixed(1)}s</small></div><Volume2 size={17}/><select aria-label="Playback speed" value={speed} onChange={e=>setSpeed(+e.target.value)}>{[0.5,0.75,1,1.25,1.5].map(v=><option key={v} value={v}>{v}× speed</option>)}</select><button className={loop?'active':''} onClick={()=>setLoop(!loop)} title="Loop section"><Repeat2 size={18}/> Loop</button><label className="check"><input type="checkbox" checked={click} onChange={e=>setClick(e.target.checked)}/> Metronome</label></div><input aria-label="Playback position" type="range" min={0} max={total} step={0.05} value={beat} onChange={e=>{current.current=+e.target.value;setBeat(current.current);onBeat(current.current);setPlaying(false);}}/>{loop&&<div className="loop-fields"><label>Loop start (beats)<input type="number" min={0} max={b-0.25} value={a} onChange={e=>setA(Math.max(0,Math.min(b-0.25,+e.target.value)))}/></label><label>Loop end (beats)<input type="number" min={a+0.25} max={total} value={b} onChange={e=>setB(Math.max(a+0.25,Math.min(total,+e.target.value)))}/></label></div>}</div>;
}
