import {afterEach,expect,it} from 'vitest'
import {getBatchQueue,resetBatchQueues} from '../../src/background/batch'
import {splitPreparedText} from '../../src/background/translate'
const opts={intervalMs:1,maxTexts:1,maxChars:1200,concurrency:1}
afterEach(resetBatchQueues)
it('shares active queues and releases dispatch closures after they become idle',async()=>{
 let release!:(value:string[])=>void
 const run=()=>new Promise<string[]>(done=>{release=done})
 const queue=getBatchQueue('fixture',run,opts)
 const task=queue.addTask('one')
 expect(getBatchQueue('fixture',run,opts)).toBe(queue)
 release(['done']);expect(await task).toBe('done')
 await new Promise(done=>setTimeout(done,0))
 expect(getBatchQueue('fixture',run,opts)).not.toBe(queue)
})
it('an old configuration finishing cannot evict its active replacement',async()=>{
 let finishOld!:(value:string[])=>void;let finishNew!:(value:string[])=>void
 const a=getBatchQueue('fixture',()=>new Promise(done=>{finishOld=done}),opts,{configuration:'old'})
 const old=a.addTask('a')
 const run=()=>new Promise<string[]>(done=>{finishNew=done})
 const b=getBatchQueue('fixture',run,opts,{configuration:'new'})
 const fresh=b.addTask('b');finishOld(['old']);await old
 await new Promise(done=>setTimeout(done,0))
 expect(getBatchQueue('fixture',run,opts,{configuration:'new'})).toBe(b)
 finishNew(['new']);expect(await fresh).toBe('new')
})
it('preserves privacy, glossary and inline tokens at long unbroken chunk boundaries',()=>{
 const text='x'.repeat(1495)+'__PII_EMAIL_1__'+'y'.repeat(1490)+'__GLOSSARY_20__'+'z'.repeat(1600)+'<a100>text</a100>'
 const parts=splitPreparedText(text,1500)
 expect(parts.join('')).toBe(text)
 expect(parts.every(part=>part.length<=1500)).toBe(true)
 for(const token of ['__PII_EMAIL_1__','__GLOSSARY_20__','<a100>','</a100>']) expect(parts.some(part=>part.includes(token))).toBe(true)
})
it('does not divide a Unicode scalar between page requests',()=>{
 const text='x'.repeat(1499)+'😀'+'y'.repeat(1500)
 const parts=splitPreparedText(text,1500)
 expect(parts.join('')).toBe(text)
 for(const part of parts)expect(()=>encodeURIComponent(part)).not.toThrow()
})
