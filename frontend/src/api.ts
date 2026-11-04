import type {Score} from './types';
export const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/,'');
export async function request(path:string, options?:RequestInit) {
  const response = await fetch(API+path,options);
  if (!response.ok) { const body=await response.text(); let message=body; try {message=JSON.parse(body).detail || body;} catch { /* plain HTTP error */ } throw new Error(typeof message==='string'?message:JSON.stringify(message)); }
  return response;
}
export async function renderScore(score:Score, format:string, view='staff', signal?:AbortSignal) {
 return request(`/api/render/${format}?view=${view}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(score),signal});
}
export async function download(score:Score,format:string,view='staff') {
 const blob=await (await renderScore(score,format,view)).blob(); const a=document.createElement('a');
 const url=URL.createObjectURL(blob); a.href=url; a.download=`${score.title.replace(/[^\w -]/g,'_')}.${format==='midi'?'mid':format==='musicxml'?'musicxml':'txt'}`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
