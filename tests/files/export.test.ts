// @vitest-environment jsdom
import {describe,it,expect,vi} from 'vitest'
import {Blob as NodeBlob} from 'node:buffer'
import {htmlParser} from '../../src/files/parsers/htmlParser'
import {epubParser} from '../../src/files/parsers/epub'
import {docxParser} from '../../src/files/parsers/docx'
import {jsonParser} from '../../src/files/parsers/jsonParser'
import {JSZip} from '../../src/files/parsers/jszip'
vi.stubGlobal('Blob',NodeBlob)
const buf=(s:string)=>new TextEncoder().encode(s).buffer
const html='<!doctype html><html><head><title>Audit fixture</title></head><body><p>Hello world.</p></body></html>'
async function epub(){const z=new JSZip();z.file('mimetype','application/epub+zip');z.file('META-INF/container.xml','<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>');z.file('content.opf','<package><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>');z.file('one.xhtml','<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Hello world.</p></body></html>');return z.generateAsync({type:'arraybuffer'})}
describe('Document export regressions',()=>{
 it('HTML repeated bilingual download stays idempotent',async()=>{
  const doc=await htmlParser.parse(buf(html),'audit.html');const t=new Map([[0,'你好世界。']]);
  const first=await (await htmlParser.build(doc,t,'bilingual')).blob.text();
  const second=await (await htmlParser.build(doc,t,'bilingual')).blob.text();
  expect(second).toBe(first)
 })
 it('HTML translation-only then bilingual preserves original source',async()=>{
  const doc=await htmlParser.parse(buf(html),'audit.html');const t=new Map([[0,'你好世界。']]);
  await htmlParser.build(doc,t,'translationOnly');
  const bilingual=await (await htmlParser.build(doc,t,'bilingual')).blob.text();
  expect(bilingual).toContain('Hello world.')
 })
 it('EPUB repeated bilingual download stays idempotent',async()=>{
  const doc=await epubParser.parse(await epub(),'audit.epub');const t=new Map([[0,'你好世界。']]);
  const a=await epubParser.build(doc,t,'bilingual');const za=await JSZip.loadAsync(await a.blob.arrayBuffer());
  const first=await za.file('one.xhtml')!.async('string');
  const b=await epubParser.build(doc,t,'bilingual');const zb=await JSZip.loadAsync(await b.blob.arrayBuffer());
  expect(await zb.file('one.xhtml')!.async('string')).toBe(first)
 })
 it('DOCX translation-only keeps newly translated line breaks and tabs',async()=>{
  const z=new JSZip();z.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello world.</w:t></w:r></w:p></w:body></w:document>');
  const doc=await docxParser.parse(await z.generateAsync({type:'arraybuffer'}),'audit.docx');
  const built=await docxParser.build(doc,new Map([[0,'第一行\n第二行\t第三列']]),'translationOnly');
  const zip=await JSZip.loadAsync(await built.blob.arrayBuffer());const xml=await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain('<w:br/>');expect(xml).toContain('<w:tab/>')
 })
 it('JSON top-level natural-language string is replaced by translation',async()=>{
  const doc=await jsonParser.parse(buf(JSON.stringify('Hello world.')),'audit.json');
  expect(doc.segments).toHaveLength(1);
  const built=await jsonParser.build(doc,new Map([[0,'你好世界。']]),'translationOnly');
  expect(JSON.parse(await built.blob.text())).toBe('你好世界。')
 })
 it('translation returned as executable HTML stays escaped',async()=>{
  const doc=await htmlParser.parse(buf(html),'audit.html');
  const built=await htmlParser.build(doc,new Map([[0,'<img src=x onerror="globalThis.pwned=1">']]),'bilingual');
  const parsed=new DOMParser().parseFromString(await built.blob.text(),'text/html');
  expect(parsed.querySelectorAll('img,script')).toHaveLength(0)
 })
 it('standard nested JSON translation works and does not pollute the prototype',async()=>{
  const doc=await jsonParser.parse(buf('{"text":"Hello world.","__proto__":{"polluted":"Hello world."}}'),'audit.json');
  const built=await jsonParser.build(doc,new Map([[0,'你好世界。']]),'translationOnly');
  expect(JSON.parse(await built.blob.text()).text).toBe('你好世界。');expect(({} as any).polluted).toBeUndefined()
 })
})
