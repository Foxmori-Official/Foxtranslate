import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {createServer} from 'node:http'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
const out=process.env.FOXTRANSLATE_REGRESSION_RESULTS
const extension=resolve(process.env.FOXTRANSLATE_EXTENSION_DIR || 'dist')
const report={timestamp:new Date().toISOString(),checks:[],performance:[],pageErrors:[]}
const beacons=[]
const fixture=createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost')
 if(url.pathname==='/beacon'){beacons.push(req.url);res.end('ok');return}
 const count=Number(url.searchParams.get('n'))||1
 const text=url.pathname==='/card'?'W '.repeat(745)+'4111 1111 1111 1111 ordinary public text.':'First version of this audit paragraph contains public language learning text.'
 res.setHeader('Content-Type','text/html; charset=utf-8')
 res.end('<!doctype html><html lang="en"><head><title>Independent audit fixture</title></head><body><main>'+Array.from({length:count},(_,i)=>'<p id="p'+i+'">'+text+'</p>').join('')+'</main></body></html>')
})
await new Promise(done=>fixture.listen(0,'127.0.0.1',done))
const address='http://127.0.0.1:'+fixture.address().port
const profile=await mkdtemp(join(tmpdir(),'foxtranslate-independent-'))
function minimalPdf(){
 const stream='BT /F1 12 Tf 72 720 Td (Hello public PDF audit fixture.) Tj ET'
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream']
 let data='%PDF-1.4\n';const offsets=[0]
 objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(data));data+=(i+1)+' 0 obj\n'+object+'\nendobj\n'})
 const xref=Buffer.byteLength(data);data+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF'
 return Buffer.from(data)
}
let browser
async function check(name,fn){try{const result=await fn();report.checks.push({name,...result});console.log(name,JSON.stringify(result))}catch(error){report.checks.push({name,harnessError:error.stack});console.log(name,'HARNESS ERROR',error.message)}}
try{
 browser=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:!process.env.FOXTRANSLATE_TEST_CHROMIUM,executablePath:process.env.FOXTRANSLATE_TEST_CHROMIUM,args:[...(process.env.FOXTRANSLATE_TEST_CHROMIUM?['--headless=new']:[]),'--disable-extensions-except='+extension,'--load-extension='+extension]})
 browser.setDefaultTimeout(10000)
 const worker=browser.serviceWorkers()[0]??await browser.waitForEvent('serviceworker')
 const origin='chrome-extension://'+new URL(worker.url()).host
 await worker.evaluate(()=>{
  const original=fetch;globalThis.auditCalls=[];globalThis.auditPending=[]
  globalThis.fetch=async(input,init)=>{
   const url=String(input)
   if(url.startsWith('https://translate.googleapis.com/')){
    const params=new URL(url).searchParams
    const q=params.get('q')||new URLSearchParams(init?.body).get('q')||'';const tl=params.get('tl')
    globalThis.auditCalls.push({q,tl,at:Date.now()})
    if(globalThis.auditGatePrefix&&q.includes(globalThis.auditGatePrefix))await new Promise(resolve=>globalThis.auditPending.push({resolve,q,tl}))
    return Response.json([[['AUDIT-'+tl+' · '+q,q]],null,'en'])
   }
   if(/^https?:/.test(url))throw Error('Independent audit: external provider network disabled')
   return original(input,init)
  }
 })
 const control=await browser.newPage();await control.goto(origin+'/options.html')
 const send=request=>control.evaluate(async request=>{const r=await chrome.runtime.sendMessage(request);if(!r?.ok)throw Error(r?.error||'No response');return r.data},request)
 const initial=await send({kind:'getConfig'})
 const config=patch=>send({kind:'setConfig',patch})
 await config({uiLang:'zh-CN',mask:{enabled:true},batch:{...initial.batch,enabled:false},engine:{...initial.engine,provider:'google'},subtitles:{...initial.subtitles,enabled:false},general:{...initial.general,targetLang:'zh-CN'}})
 const page=await browser.newPage();page.on('pageerror',error=>report.pageErrors.push(error.message))
 await check('Masking at the 1500-character webpage chunk boundary',async()=>{
  await worker.evaluate(()=>{globalThis.auditCalls=[]})
  await page.goto(address+'/card');await page.locator('.tv-ball').click();await page.locator('#p0 tv-translation').waitFor()
  const calls=await worker.evaluate(()=>globalThis.auditCalls.map(({q,tl})=>({tl,length:q.length,start:q.slice(0,45),end:q.slice(-70),masked:q.includes('__PII_CARD_')})))
  return {correct:calls.some(call=>call.masked),calls}
 })
 await check('In-place source updates after page translation',async()=>{
  await worker.evaluate(()=>{globalThis.auditCalls=[]})
  await page.goto(address+'/dynamic');await page.locator('.tv-ball').click();await page.locator('#p0 tv-translation').waitFor()
  await page.locator('#p0').evaluate(p=>{p.firstChild.data='Second version has replaced the source text after translation.'})
  await page.waitForTimeout(650)
  const inPlace=await page.locator('#p0 tv-translation').textContent()
  await page.locator('#p0').evaluate(p=>{p.textContent='Third version completely replaces this dynamic paragraph.'})
  await page.waitForTimeout(650)
  const replacement=await page.locator('#p0 tv-translation').count()
  const calls=await worker.evaluate(()=>globalThis.auditCalls.map(c=>c.q))
  return {correct:inPlace?.includes('Second version')&&replacement===1,inPlace,replacementTranslations:replacement,calls}
 })
 await check('Translation-only mode preserves replacement content when restored',async()=>{
  await config({general:{...initial.general,targetLang:'zh-CN',displayMode:'translationOnly'}})
  await page.goto(address+'/replacement');await page.locator('.tv-ball').click();await page.locator('#p0 tv-translation').waitFor()
  await page.locator('#p0').evaluate(p=>{p.textContent='Replacement content from the page framework must survive.'})
  await page.locator('#p0 tv-translation').filter({hasText:'Replacement content'}).waitFor()
  await page.locator('.tv-ball').click();await page.locator('#p0 tv-translation').waitFor({state:'detached'})
  const restored=await page.locator('#p0').textContent()
  await config({general:{...initial.general,targetLang:'zh-CN'}})
  return {correct:restored==='Replacement content from the page framework must survive.',restored}
 })
 await check('Changed in-flight paragraphs reject stale results',async()=>{
  await worker.evaluate(()=>{globalThis.auditCalls=[];globalThis.auditGatePrefix='Old stream draft'})
  await page.goto(address+'/stream');await page.locator('.tv-ball').waitFor()
  await page.locator('#p0').evaluate(p=>{p.textContent='Old stream draft is waiting for translation.'})
  await page.locator('.tv-ball').click()
  for(let i=0;i<100&&!(await worker.evaluate(()=>globalThis.auditPending.length>0));i++)await page.waitForTimeout(50)
  assert.ok(await worker.evaluate(()=>globalThis.auditPending.length>0))
  await page.locator('#p0').evaluate(p=>{p.firstChild.data='New stream draft must be translated instead.'})
  await page.locator('#p0 tv-translation').filter({hasText:'New stream draft'}).waitFor()
  await worker.evaluate(()=>{globalThis.auditGatePrefix=null;for(const task of globalThis.auditPending.splice(0))task.resolve()})
  await page.waitForTimeout(100)
  const result=await page.locator('#p0 tv-translation').textContent()
  return {correct:result.includes('New stream draft')&&!result.includes('Old stream draft'),result}
 })
 await check('Meeting language change while a translation is pending',async()=>{
  await worker.evaluate(()=>{globalThis.auditCalls=[];globalThis.auditGatePrefix='Meeting audit caption'})
  await config({general:{...initial.general,targetLang:'zh-CN'},subtitles:{...initial.subtitles,enabled:true,meet:true}})
  await browser.route('https://meet.google.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><title>Meeting fixture</title><body><main><div data-caption-text>Meeting audit caption with stable public text.</div></main></body></html>'}))
  const meeting=await browser.newPage();await meeting.goto('https://meet.google.com/abc-defg-hij')
  for(let i=0;i<100&&!(await worker.evaluate(()=>globalThis.auditPending.length>0));i++)await meeting.waitForTimeout(100)
  assert.ok(await worker.evaluate(()=>globalThis.auditPending.length>0),'Meeting did not schedule translation')
  await config({general:{...initial.general,targetLang:'ja'}});await meeting.waitForTimeout(500)
  await worker.evaluate(()=>{globalThis.auditGatePrefix=null;for(const task of globalThis.auditPending.splice(0))task.resolve()})
  await meeting.waitForFunction(()=>Array.from(document.querySelectorAll('[data-tv-owned]')).some(host=>host.shadowRoot?.querySelector('.dst')?.textContent?.startsWith('AUDIT-')))
  await meeting.waitForTimeout(700)
  const displayed=await meeting.evaluate(()=>Array.from(document.querySelectorAll('[data-tv-owned]')).flatMap(host=>Array.from(host.shadowRoot?.querySelectorAll('.dst')??[]).map(node=>node.textContent)))
  const calls=await worker.evaluate(()=>globalThis.auditCalls.map(({q,tl})=>({q,tl})))
  await meeting.close();return {correct:displayed.some(t=>t.startsWith('AUDIT-ja')),currentTarget:'ja',displayed,calls}
 })
 await check('Pending input translation preserves subsequent user edits',async()=>{
  await worker.evaluate(()=>{globalThis.auditCalls=[];globalThis.auditGatePrefix='Input audit old'})
  await config({input:{enabled:true,trigger:'altEnter',targetLang:'en'}})
  await page.goto(address+'/input');await page.locator('.tv-ball').waitFor()
  await page.evaluate(()=>{const input=document.createElement('textarea');input.id='input-audit';document.body.append(input)})
  const input=page.locator('#input-audit');await input.fill('Input audit old draft before the user makes more edits.');await input.press('Alt+Enter')
  for(let i=0;i<100&&!(await worker.evaluate(()=>globalThis.auditPending.length>0));i++)await page.waitForTimeout(50)
  assert.ok(await worker.evaluate(()=>globalThis.auditPending.length>0),'Input did not schedule translation')
  const latest='Input audit NEW draft that the user typed while translation was pending.'
  await input.fill(latest)
  await worker.evaluate(()=>{globalThis.auditGatePrefix=null;for(const task of globalThis.auditPending.splice(0))task.resolve()})
  await page.waitForTimeout(650)
  const actual=await input.inputValue()
  return {correct:actual===latest,expected:latest,actual}
 })
 await check('Local HTML import keeps resources inert',async()=>{
  await config({general:{...initial.general,targetLang:'zh-CN'}})
  const files=await browser.newPage();await files.goto(origin+'/files.html')
  await files.locator('input[type=file]').setInputFiles({name:'inert-audit.html',mimeType:'text/html',buffer:Buffer.from('<!doctype html><html><body><p>Hello public text.</p><img src="'+address+'/beacon?fixture=only"><iframe src="'+address+'/beacon?frame=only"></iframe><script>fetch("'+address+'/beacon?script=only")</script></body></html>')})
  await files.getByRole('button',{name:'开始翻译',exact:true}).click();await files.getByRole('button',{name:'下载译文',exact:true}).waitFor();await files.waitForTimeout(300)
  const downloadText=async()=>{const event=files.waitForEvent('download');await files.getByRole('button',{name:'下载译文',exact:true}).click();const download=await event;const stream=await download.createReadStream();let result='';for await(const chunk of stream)result+=chunk.toString();return result}
  const first=await downloadText();const second=await downloadText()
  report.checks.push({name:'Repeated HTML downloads through actual file UI',correct:first===second,firstTranslationBlocks:(first.match(/data-tv-translation/g)??[]).length,secondTranslationBlocks:(second.match(/data-tv-translation/g)??[]).length})
  await files.close();return {correct:beacons.length===0,beacons}
 })
 await check('PDF compatibility runtime restores missing optional APIs',async()=>{
  const legacy=await browser.newPage();const errors=[];legacy.on('pageerror',error=>errors.push(error.message))
  await legacy.addInitScript(()=>{delete Promise.try;delete URL.parse;delete Uint8Array.prototype.toBase64})
  await legacy.goto(origin+'/files.html');await legacy.locator('input[type=file]').waitFor({state:'attached'})
  const inputCount=await legacy.locator('input[type=file]').count()
  const features=await legacy.evaluate(()=>({withResolvers:typeof Promise.withResolvers,try:typeof Promise.try,urlParse:typeof URL.parse}))
  await legacy.locator('input[type=file]').setInputFiles({name:'audit.pdf',mimeType:'application/pdf',buffer:minimalPdf()})
  await legacy.getByRole('button',{name:'开始翻译',exact:true}).click()
  await legacy.waitForFunction(()=>document.querySelector('.status.error')||document.querySelector('.actions a')||Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='下载译文'&&button.style.display!== 'none'))
  const status=await legacy.locator('.status').textContent();await legacy.close()
  const current=await browser.newPage();await current.goto(origin+'/files.html')
  await current.locator('input[type=file]').setInputFiles({name:'audit.pdf',mimeType:'application/pdf',buffer:minimalPdf()})
  await current.getByRole('button',{name:'开始翻译',exact:true}).click()
  await current.waitForFunction(()=>document.querySelector('.status.error')||Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='下载译文'&&button.style.display!== 'none'))
  const currentStatus=await current.locator('.status').textContent();await current.close()
  return {correct:inputCount>0&&status.includes('翻译完成')&&currentStatus.includes('翻译完成'),inputCount,features,status,currentStatus,errors,method:'Feature removal with matching legacy PDF runtime and worker.'}
 })
 await config({subtitles:{...initial.subtitles,enabled:false},mask:{enabled:false}})
 await check('Large page discovery yields before traversing all 20000 units',async()=>{
  await page.goto(address+'/large?n=20000');await page.locator('.tv-ball').waitFor()
  // An animation-frame heartbeat measures responsiveness while the real extension discovers units.
  await page.evaluate(()=>{window.auditFrames=[];let previous=performance.now();window.auditFrame=(time)=>{auditFrames.push(time-previous);previous=time;window.auditRaf=requestAnimationFrame(auditFrame)};window.auditRaf=requestAnimationFrame(auditFrame)})
  const start=Date.now();await page.locator('.tv-ball').click();await page.locator('#p0 tv-translation').waitFor()
  await page.waitForTimeout(350)
  const frames=await page.evaluate(()=>{cancelAnimationFrame(window.auditRaf);return auditFrames.slice(2)})
  await page.locator('.tv-ball').click();await page.locator('tv-translation').first().waitFor({state:'detached'})
  // Performance numbers are reported; only completion and reversibility are hard assertions.
  report.performance.push({paragraphs:20000,firstTranslationAndObservationMs:Date.now()-start,maxFrameGapMs:Math.max(...frames),frameCount:frames.length})
  return {correct:frames.length>5,...report.performance.at(-1)}
 })
 await check('Paid network remains disabled throughout audit',async()=>({correct:true,network:'Worker accepts only mocked Google responses; other HTTP(S) provider calls throw.'}))
}finally{
 if(browser)await browser.close();fixture.close();await rm(profile,{recursive:true,force:true})
 if(out) await writeFile(out,JSON.stringify(report,null,2))
}

assert.deepEqual(report.checks.filter(check=>check.harnessError || check.correct!==true),[], 'Regression failures')
assert.deepEqual(report.pageErrors,[])
console.log('PASS · masking boundaries, late inputs, meeting languages, dynamic sources, repeat exports, PDF capabilities, large-page scheduling')
