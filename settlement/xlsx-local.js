(function(global){
  'use strict';
  const TD = new TextDecoder('utf-8');
  const XML_ENT = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
  function decodeXml(s){
    return String(s||'').replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,(m,k)=>{
      if(k[0]==='#'){
        const n=k[1].toLowerCase()==='x'?parseInt(k.slice(2),16):parseInt(k.slice(1),10);
        return Number.isFinite(n)?String.fromCodePoint(n):m;
      }
      return XML_ENT[k]??m;
    });
  }
  function attr(s,name){
    const m=String(s||'').match(new RegExp('(?:^|\\s)'+name.replace(':','\\:')+'="([^"]*)"'));
    return m?decodeXml(m[1]):null;
  }
  function u16(v,o){return v.getUint16(o,true)}
  function u32(v,o){return v.getUint32(o,true)}
  function findEocd(v){
    const start=Math.max(0,v.byteLength-0x10000-22);
    for(let i=v.byteLength-22;i>=start;i--)if(u32(v,i)===0x06054b50)return i;
    throw new Error('올바른 XLSX ZIP 구조를 찾지 못했습니다.');
  }
  function zipIndex(buf){
    const v=new DataView(buf), e=findEocd(v), total=u16(v,e+10), cdOff=u32(v,e+16), out=new Map();
    let p=cdOff;
    for(let i=0;i<total;i++){
      if(u32(v,p)!==0x02014b50)throw new Error('XLSX ZIP 중앙 디렉터리가 손상되었습니다.');
      const flags=u16(v,p+8), method=u16(v,p+10), csize=u32(v,p+20), usize=u32(v,p+24), fnl=u16(v,p+28), exl=u16(v,p+30), col=u16(v,p+32), loff=u32(v,p+42);
      const name=TD.decode(new Uint8Array(buf,p+46,fnl));
      out.set(name,{flags,method,csize,usize,loff});
      p+=46+fnl+exl+col;
    }
    return out;
  }
  async function unzipEntry(buf,index,name){
    const e=index.get(name); if(!e)throw new Error('XLSX 내부 파일이 없습니다: '+name);
    if(e.flags&1)throw new Error('암호화된 XLSX 파일은 지원하지 않습니다.');
    const v=new DataView(buf), p=e.loff;
    if(u32(v,p)!==0x04034b50)throw new Error('XLSX ZIP 로컬 헤더가 손상되었습니다.');
    const fnl=u16(v,p+26), exl=u16(v,p+28), start=p+30+fnl+exl;
    const raw=new Uint8Array(buf,start,e.csize);
    if(e.method===0)return new Uint8Array(raw);
    if(e.method!==8)throw new Error('지원하지 않는 XLSX 압축 방식입니다: '+e.method);
    if(typeof DecompressionStream==='undefined')throw new Error('이 브라우저는 XLSX 압축 해제를 지원하지 않습니다. 최신 Chrome을 사용해주세요.');
    const ds=new DecompressionStream('deflate-raw');
    const ab=await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(ab);
  }
  async function textEntry(buf,index,name){return TD.decode(await unzipEntry(buf,index,name))}
  function resolvePath(base,target){
    if(target.startsWith('/'))return target.replace(/^\//,'');
    const parts=(base+'/'+target).split('/'), out=[];
    for(const x of parts){if(!x||x==='.')continue;if(x==='..')out.pop();else out.push(x)}
    return out.join('/');
  }
  function sharedStrings(xml){
    const out=[]; const re=/<si\b[^>]*>([\s\S]*?)<\/si>/g; let m;
    while((m=re.exec(xml))){let s='',t;const tr=/<t\b[^>]*>([\s\S]*?)<\/t>/g;while((t=tr.exec(m[1])))s+=decodeXml(t[1]);out.push(s)}
    return out;
  }
  function colIndex(ref){
    const m=String(ref||'').match(/^([A-Z]+)/i); if(!m)return 0; let n=0;
    for(const ch of m[1].toUpperCase())n=n*26+ch.charCodeAt(0)-64;
    return n-1;
  }
  function sheetMatrix(xml,ss){
    const out=[]; const rr=/<row\b([^>]*)>([\s\S]*?)<\/row>/g; let rm;
    while((rm=rr.exec(xml))){
      const rnum=Number(attr(rm[1],'r')||out.length+1), row=[]; const cr=/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let cm;
      while((cm=cr.exec(rm[2]))){
        const a=cm[1]||'', body=cm[2]||'', ref=attr(a,'r'), type=attr(a,'t')||'', ci=colIndex(ref);
        let val=null;
        if(type==='inlineStr'){
          let s='',tm;const tr=/<t\b[^>]*>([\s\S]*?)<\/t>/g;while((tm=tr.exec(body)))s+=decodeXml(tm[1]);val=s;
        }else{
          const vm=body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/); if(!vm)continue; const raw=decodeXml(vm[1]);
          if(type==='s')val=ss[Number(raw)]??'';
          else if(type==='str'||type==='e'||type==='d')val=raw;
          else if(type==='b')val=raw==='1';
          else { const n=Number(raw); val=raw!==''&&Number.isFinite(n)?n:raw; }
        }
        row[ci]=val;
      }
      out[rnum-1]=row;
    }
    return out;
  }
  function workbookSheets(wbXml,relsXml){
    const rels=new Map(); let m; const rr=/<Relationship\b([^>]*?)(?:\/>|>[\s\S]*?<\/Relationship>)/g;
    while((m=rr.exec(relsXml))){const id=attr(m[1],'Id'), target=attr(m[1],'Target');if(id&&target)rels.set(id,target)}
    const out=[]; const sr=/<sheet\b([^>]*?)(?:\/>|><\/sheet>)/g;
    while((m=sr.exec(wbXml))){const name=attr(m[1],'name'),rid=attr(m[1],'r:id');if(name&&rid&&rels.has(rid))out.push({name,path:resolvePath('xl',rels.get(rid))})}
    return out;
  }
  function excelDateCode(v){
    const n=Number(v); if(!Number.isFinite(n))return null;
    const days=Math.floor(n), frac=n-days, ms=(days-25569)*86400000+Math.round(frac*86400000), d=new Date(ms);
    if(Number.isNaN(d.getTime()))return null;
    return {y:d.getUTCFullYear(),m:d.getUTCMonth()+1,d:d.getUTCDate(),H:d.getUTCHours(),M:d.getUTCMinutes(),S:d.getUTCSeconds()};
  }
  async function read(input){
    const buf=input instanceof ArrayBuffer?input:input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength), idx=zipIndex(buf);
    const wbXml=await textEntry(buf,idx,'xl/workbook.xml'), relsXml=await textEntry(buf,idx,'xl/_rels/workbook.xml.rels');
    const specs=workbookSheets(wbXml,relsXml), wanted=new Set(['정산내역기록','플랫폼매핑','정산서']), sheets={};
    let ss=[]; if(idx.has('xl/sharedStrings.xml'))ss=sharedStrings(await textEntry(buf,idx,'xl/sharedStrings.xml'));
    for(const spec of specs){
      const normalizedName=spec.name.trim().normalize('NFC');
      if(!wanted.has(normalizedName))continue;
      sheets[normalizedName]=sheetMatrix(await textEntry(buf,idx,spec.path),ss);
    }
    return {SheetNames:specs.map(x=>x.name),Sheets:sheets};
  }
  global.XLSX={
    __kennethLocal:true,
    read,
    utils:{sheet_to_json(ws,opt){if(!Array.isArray(ws))return[];if(opt&&opt.header===1)return ws;return ws;}},
    SSF:{parse_date_code:excelDateCode}
  };
})(typeof window!=='undefined'?window:globalThis);
