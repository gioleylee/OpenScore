import {useEffect,useRef,useState} from 'react';
import {OpenSheetMusicDisplay} from 'opensheetmusicdisplay';
import {renderScore} from './api';
import type {Score} from './types';

export function ScoreView({score,view,zoom,beat}:{score:Score;view:string;zoom:number;beat:number}) {
 const container=useRef<HTMLDivElement>(null), osmd=useRef<OpenSheetMusicDisplay|null>(null);
 const [error,setError]=useState(''), [loading,setLoading]=useState(false);
 useEffect(()=>{if(!container.current)return; const display=new OpenSheetMusicDisplay(container.current,{autoResize:true,backend:'svg',drawTitle:true,drawComposer:false,drawPartNames:true,drawMeasureNumbers:true}); osmd.current=display; return()=>{display.clear();osmd.current=null;};},[]);
 useEffect(()=>{const controller=new AbortController(); setLoading(true); setError(''); const display=osmd.current;
   renderScore(score,'musicxml',view,controller.signal).then(r=>r.text()).then(async xml=>{if(controller.signal.aborted||!display)return; await display.load(xml); if(controller.signal.aborted)return; display.Zoom=zoom;display.render();display.cursor.show();setLoading(false);}).catch(e=>{if(!controller.signal.aborted){setError(String(e));setLoading(false);}});
   return()=>controller.abort();
 },[score,view,zoom]);
 useEffect(()=>{const cursor=osmd.current?.cursor;if(!cursor||loading||error)return;try{cursor.reset();let guard=0;while(!cursor.Iterator.EndReached&&cursor.Iterator.currentTimeStamp.RealValue*4<beat&&guard++<15000)cursor.next();cursor.show();}catch{/* Piano roll remains the playback position fallback. */}},[beat,loading,error]);
 return <div className="score-paper">{loading&&<div className="engraving-status no-print">Engraving your score…</div>}{error&&<p role="alert" className="error">{error} Piano roll and MIDI remain available. Try shorter, grid-aligned durations.</p>}<div ref={container}/></div>;
}
