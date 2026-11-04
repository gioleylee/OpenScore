export type Mode = 'melody'|'piano'|'guitar'|'bass';
export interface Settings {mode: Mode; engine: 'pyin'|'basic_pitch'; instrument: string; start: number; end: number|null; tempo: number|null; numerator: number; denominator: 4|8; grid: 0.25|0.5|1; min_duration: number; sensitivity: number; tuning: number[]; capo: number; min_fret: number; max_fret: number}
export interface Note {id: string; pitch: number; onset: number; duration: number; velocity: number; string: number|null; fret: number|null}
export interface Score {title: string; tempo: number; key: number; settings: Settings; notes: Note[]; warnings: string[]}
export interface Result {score: Score; audio: {duration: number; segment_duration: number; segment_start: number; waveform: number[]}}
export const defaults: Settings = {mode:'melody',engine:'pyin',instrument:'Guitar',start:0,end:null,tempo:null,numerator:4,denominator:4,grid:0.25,min_duration:0.09,sensitivity:0.3,tuning:[40,45,50,55,59,64],capo:0,min_fret:0,max_fret:20};
export const pitchName = (p:number) => ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][((p%12)+12)%12]+(Math.floor(p/12)-1);
