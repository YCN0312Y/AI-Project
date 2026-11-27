import {ALL_VILLAGES} from './world-map.js'
export const VILLAGE_SIZES={small:{name:'小村庄',cap:500,growth:5,min:1,max:3},medium:{name:'中村庄',cap:1000,growth:10,min:3,max:5},large:{name:'大村庄',cap:2000,growth:20,min:5,max:10}}
export const freshPopulation=()=>({populationClock:0,villagePopulation:Object.fromEntries(ALL_VILLAGES.map(v=>[v.id,VILLAGE_SIZES[v.size].cap]))})
export const populationRule=id=>VILLAGE_SIZES[ALL_VILLAGES.find(v=>v.id===id)?.size]||null
export const villagePopulation=(s,id)=>s.villagePopulation?.[id]??populationRule(id)?.cap??0
export function normalizePopulation(s,raw){
  Object.assign(s,freshPopulation())
  if(Number.isFinite(raw?.populationClock)&&raw.populationClock>=0&&raw.populationClock<60)s.populationClock=raw.populationClock
  for(const v of ALL_VILLAGES)if(Number.isFinite(raw?.villagePopulation?.[v.id]))s.villagePopulation[v.id]=Math.max(0,Math.min(populationRule(v.id).cap,Math.floor(raw.villagePopulation[v.id])))
}
export function advancePopulation(s,seconds,random=Math.random){
  if(!Number.isFinite(seconds)||seconds<0)return 0
  s.villagePopulation||=freshPopulation().villagePopulation
  s.populationClock=(Number.isFinite(s.populationClock)?s.populationClock:0)+seconds;let grown=0
  const cycles=Math.floor((s.populationClock+1e-8)/60)
  if(cycles>0){
    s.populationClock=Math.max(0,s.populationClock-cycles*60)
    for(let cycle=0;cycle<cycles;cycle++)for(const v of ALL_VILLAGES){
      const rule=populationRule(v.id),before=villagePopulation(s,v.id);if(before>=rule.cap)continue
      const value=random(),roll=Number.isFinite(value)?Math.max(0,Math.min(.999999999,value)):0
      s.villagePopulation[v.id]=Math.min(rule.cap,before+Math.floor(roll*(rule.growth+1)));grown+=s.villagePopulation[v.id]-before
    }
  }
  return grown
}
export function takeVillageRecruits(s,id,room,random=Math.random){
  const rule=populationRule(id),available=villagePopulation(s,id)
  if(!rule||available<=0||room<=0)return 0
  const value=random(),roll=Number.isFinite(value)?Math.max(0,Math.min(.999999999,value)):0
  const count=Math.min(available,Math.max(0,Math.floor(room)),rule.min+Math.floor(roll*(rule.max-rule.min+1)))
  s.villagePopulation[id]=available-count;return count
}
