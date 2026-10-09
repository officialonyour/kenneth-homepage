(function(global){
  'use strict';

  // Keep file-format adaptation separate from the count-quality rules in app.js.
  const INTEGRATED_HEADERS = {
    'No':'source_row_no','유통사':'distributor','정산서파일':'source_file',
    '정산연도':'settlement_year','정산월':'settlement_month','정산년월':'settlement_ym',
    '발생연도':'occurrence_year','발생월':'occurrence_month','발생년월':'occurrence_ym',
    '아티스트':'artist','앨범명':'album_title','곡명':'song_title',
    '원본플랫폼':'original_platform','원본서비스명':'original_service',
    '원본출처키':'source_key','플랫폼(통합)':'platform','원본카운트':'original_count',
    '보정카운트':'adjusted_count','정산금액':'settlement_amount','수익출처':'revenue_source',
    '비고':'notes','월곡키':'month_song_key'
  };
  const TEXT_FIELDS = ['artist','album_title','song_title','original_platform','original_service',
    'source_key','platform','revenue_source','notes','month_song_key'];
  const ENTITIES = {amp:'&',apos:"'",quot:'"',lt:'<',gt:'>',nbsp:' '};
  const LUMINANT_HEADERS = ['플랫폼명','서비스명','곡명','앨범명','아티스트명',
    '업체앨범코드','업체곡코드','카운트','인접권료','정산금액'];

  function text(value){return String(value??'').trim().normalize('NFC')}
  function header(value){return text(value).replace(/[\s\u200b\ufeff]/g,'')}
  function number(value){
    if(value===null||value===undefined||value==='')return null;
    if(typeof value==='number')return Number.isFinite(value)?value:null;
    const raw=text(value).replace(/[,₩원\s]/g,'');
    if(!raw)return null;
    const n=Number(raw);return Number.isFinite(n)?n:null;
  }
  function decodeEntities(value){
    let result=text(value);
    for(let pass=0;pass<2;pass++){
      const next=result.replace(/&(#x[\da-f]+|#\d+|amp|apos|quot|lt|gt|nbsp);/gi,(match,key)=>{
        if(key[0]!=='#')return ENTITIES[key.toLowerCase()]??match;
        const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);
        return Number.isFinite(n)&&n>=0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):match;
      });
      if(next===result)break;result=next;
    }
    return result;
  }
  function yearNumber(value){
    const m=text(value).match(/^(\d{4})(?:\s*년)?$/);return m?Number(m[1]):null;
  }
  function monthNumber(value){
    const m=text(value).match(/^(\d{1,2})(?:\s*월)?$/);return m?Number(m[1]):null;
  }
  function makeYm(year,month){
    return Number.isInteger(year)&&year>=1900&&year<=2200&&Number.isInteger(month)&&month>=1&&month<=12
      ?`${year}-${String(month).padStart(2,'0')}`:null;
  }
  function parseYm(value,year,month){
    if(value instanceof Date&&!Number.isNaN(value.getTime()))return makeYm(value.getFullYear(),value.getMonth()+1);
    const raw=text(value),match=raw.match(/((?:19|20)\d{2})\D*(\d{1,2})/);
    if(match)return makeYm(Number(match[1]),Number(match[2]));
    if(typeof value==='number'&&global.XLSX?.SSF?.parse_date_code){
      const d=global.XLSX.SSF.parse_date_code(value);if(d){const ym=makeYm(d.y,d.m);if(ym)return ym;}
    }
    return makeYm(yearNumber(year),monthNumber(month));
  }
  function shiftYm(value,delta){
    if(!/^\d{4}-\d{2}$/.test(value||''))return null;
    const date=new Date(Date.UTC(Number(value.slice(0,4)),Number(value.slice(5,7))-1+delta,1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;
  }
  function matrix(ws){return global.XLSX.utils.sheet_to_json(ws,{header:1,defval:null,raw:true})}
  function findHeader(rows,required){
    for(let i=0;i<Math.min(20,rows.length);i++){
      const names=new Set((rows[i]||[]).map(header));
      if(required.every(x=>names.has(header(x))))return i;
    }
    return -1;
  }
  function sheet(wb,name){
    for(const key of Object.keys(wb.Sheets||{}))if(header(key)===header(name))return wb.Sheets[key];
    return null;
  }
  function normalizeIntegratedRow(row,filename){
    row.source_row_no=number(row.source_row_no);
    row.distributor=text(row.distributor||'미분류');
    row.source_file=text(row.source_file||filename);
    row.settlement_ym=parseYm(row.settlement_ym,row.settlement_year,row.settlement_month);
    row.occurrence_ym=row.settlement_ym?shiftYm(row.settlement_ym,-3):null;
    row.settlement_year=row.settlement_ym?Number(row.settlement_ym.slice(0,4)):number(row.settlement_year);
    row.settlement_month=row.settlement_ym?Number(row.settlement_ym.slice(5,7)):number(row.settlement_month);
    row.occurrence_year=row.occurrence_ym?Number(row.occurrence_ym.slice(0,4)):null;
    row.occurrence_month=row.occurrence_ym?Number(row.occurrence_ym.slice(5,7)):null;
    for(const key of TEXT_FIELDS)row[key]=text(row[key]);
    for(const key of ['original_count','adjusted_count','settlement_amount'])row[key]=number(row[key]);
    return row;
  }
  function integrated(wb,ws,filename){
    const table=matrix(ws),hi=findHeader(table,['유통사','곡명','정산년월','정산금액']);
    if(hi<0)throw new Error('정산내역기록 시트에서 유통사, 곡명, 정산년월, 정산금액 헤더를 찾지 못했습니다.');
    const fields=Object.fromEntries(Object.entries(INTEGRATED_HEADERS).map(([key,value])=>[header(key),value]));
    const names=(table[hi]||[]).map(value=>fields[header(value)]||null),rows=[];
    for(let i=hi+1;i<table.length;i++){
      const line=table[i]||[],row={};names.forEach((key,j)=>{if(key)row[key]=line[j]});
      if(text(row.song_title))rows.push(normalizeIntegratedRow(row,filename));
    }
    const mappings=[],mappingSheet=sheet(wb,'플랫폼매핑');
    if(mappingSheet){
      const table=matrix(mappingSheet),hi=findHeader(table,['원본출처키','통합플랫폼']);
      if(hi>=0){
        const fields={'원본출처키':'source_key','통합플랫폼':'platform','원본플랫폼':'original_platform','원본서비스명':'original_service'};
        const names=(table[hi]||[]).map(value=>fields[header(value)]||null);
        for(let i=hi+1;i<table.length;i++){
          const line=table[i]||[],mapping={};names.forEach((key,j)=>{if(key)mapping[key]=line[j]});
          if(mapping.source_key)mappings.push(mapping);
        }
      }
    }
    return finish(rows,mappings,'integrated','통합 정산서');
  }
  function metadata(table,limit,label){
    for(let i=0;i<Math.min(limit,table.length);i++){
      const row=table[i]||[];
      for(let j=0;j<row.length;j++)if(header(row[j])===header(label))return row[j+1]??null;
    }
    return null;
  }
  function minerva(ws,filename){
    const table=matrix(ws),hi=findHeader(table,['아티스트명','앨범명','곡명','정산처','서비스명','카운트','계약자정산']);
    if(hi<0)throw new Error('미네르바 정산서에서 곡명, 정산처, 서비스명, 카운트, 계약자정산 헤더를 찾지 못했습니다.');
    if(!table.slice(0,hi).some(row=>(row||[]).some(value=>/미네르바\s*정산서/.test(text(value)))))
      throw new Error('지원하는 미네르바 정산서 형식이 아닙니다.');
    const fileMatch=text(filename).match(/((?:19|20)\d{2})\s*년[\s_]*(\d{1,2})\s*월/);
    const yearValue=metadata(table,hi,'정산연도'),monthValue=metadata(table,hi,'정산월');
    const year=yearValue===null&&fileMatch?Number(fileMatch[1]):yearNumber(yearValue);
    const month=monthValue===null&&fileMatch?Number(fileMatch[2]):monthNumber(monthValue);
    const ym=makeYm(year,month);
    if(!ym)throw new Error('미네르바 정산서의 정산연도·정산월을 확인해주세요.');
    const occurrenceYm=shiftYm(ym,-3),salesMonthValue=metadata(table,hi,'판매월');
    if(salesMonthValue!==null&&monthNumber(salesMonthValue)!==Number(occurrenceYm.slice(5,7)))
      throw new Error('미네르바 판매월이 정산월의 3개월 전과 다릅니다. 정산서 기준월을 확인해주세요.');
    const names=Array.from(table[hi]||[],header),columns=Object.fromEntries(names.map((name,index)=>[name,index]));
    const rows=[];
    for(let i=hi+1;i<table.length;i++){
      const line=table[i]||[],get=name=>line[columns[header(name)]],song=decodeEntities(get('곡명'));
      if(!song)continue;
      if(/^(합계|총계|소계|total)$/i.test(song)&&!text(get('아티스트명'))&&!text(get('앨범명')))continue;
      const amount=number(get('계약자정산'));
      if(amount===null)throw new Error(`미네르바 정산서 ${i+1}행의 계약자정산 금액을 확인해주세요.`);
      const originalPlatform=decodeEntities(get('정산처')),originalService=decodeEntities(get('서비스명'));
      const notes=['앨범코드','정산구분','VedioID','ChannelID'].map(label=>{
        const value=decodeEntities(get(label));return value?`${label}: ${value}`:'';
      }).filter(Boolean).join(' · ');
      rows.push({
        import_format:'minerva',source_row_no:i+1,distributor:'미네르바',source_file:text(filename),
        settlement_year:year,settlement_month:month,settlement_ym:ym,
        occurrence_year:Number(occurrenceYm.slice(0,4)),occurrence_month:Number(occurrenceYm.slice(5,7)),occurrence_ym:occurrenceYm,
        artist:decodeEntities(get('아티스트명')),album_title:decodeEntities(get('앨범명')),song_title:song,
        original_platform:originalPlatform,original_service:originalService,source_key:`${originalPlatform}|${originalService}`,
        // Existing mapping data can resolve the provider. Do not invent global mappings from a raw statement.
        platform:originalPlatform||'미분류',original_count:number(get('카운트')),adjusted_count:null,
        settlement_amount:amount,revenue_source:decodeEntities(get('정산구분')),notes,month_song_key:''
      });
    }
    const occurrences=new Map();
    for(const row of rows){
      const identity=[row.distributor,row.settlement_ym,row.artist,row.album_title,row.song_title,row.original_platform,row.original_service].map(decodeEntities);
      identity.push(row.original_count===null?null:Math.round(row.original_count));
      const key=JSON.stringify(identity),amount=row.settlement_amount;
      const groups=occurrences.get(key)||[];
      let group=groups.find(value=>Math.abs(value.amount-amount)<0.0000001);
      if(!group){group={amount,count:0};groups.push(group);occurrences.set(key,groups)}
      row.import_occurrence=++group.count;
    }
    const result=finish(rows,[],'minerva','미네르바 개별 정산서');
    const expected=number(metadata(table,hi,'당월금액'));
    if(expected!==null&&Math.abs(expected-result.revenue)>0.00001)
      throw new Error('미네르바 세부 정산금액 합계가 당월금액과 다릅니다. 원본 정산서를 확인해주세요.');
    result.settlementYm=ym;result.statementRevenue=expected;
    return result;
  }
  function csvError(line,message){
    return new Error(`루미넌트 CSV ${line}행: ${message}`);
  }
  function csvRecords(csvText){
    if(typeof csvText!=='string')throw new Error('CSV 파일 내용을 읽지 못했습니다.');
    const input=csvText.charCodeAt(0)===0xfeff?csvText.slice(1):csvText;
    const records=[];
    let values=[],field='',line=1,startLine=1,inQuotes=false,closedQuote=false,quotedField=false;
    const endField=()=>{values.push(field);field='';closedQuote=false;quotedField=false;};
    const endRecord=()=>{
      endField();
      // Ignore empty physical lines, but keep an empty multi-column record for validation.
      if(values.length!==1||values[0].trim()!=='')records.push({values,line:startLine});
      values=[];
    };
    for(let i=0;i<input.length;i++){
      const char=input[i];
      if(inQuotes){
        if(char==='"'){
          if(input[i+1]==='"'){field+='"';i++;}
          else{inQuotes=false;closedQuote=true;}
        }else if(char==='\r'||char==='\n'){
          field+=char;
          if(char==='\r'&&input[i+1]==='\n'){field+='\n';i++;}
          line++;
        }else field+=char;
        continue;
      }
      if(char===','){endField();continue;}
      if(char==='\r'||char==='\n'){
        endRecord();
        if(char==='\r'&&input[i+1]==='\n')i++;
        line++;startLine=line;
        continue;
      }
      if(closedQuote)throw csvError(line,'닫는 따옴표 뒤에는 쉼표 또는 줄바꿈만 올 수 있습니다.');
      if(char==='"'){
        if(field!==''||quotedField)throw csvError(line,'필드 중간의 따옴표가 올바르지 않습니다.');
        inQuotes=true;quotedField=true;
      }else field+=char;
    }
    if(inQuotes)throw csvError(startLine,'따옴표로 시작한 필드가 끝나지 않았습니다.');
    if(values.length||field!==''||quotedField||closedQuote)endRecord();
    return records;
  }
  function csvNumber(value,label,line,count=false){
    const raw=String(value??'').trim();
    const decimal=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
    const grouped=/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?(?:[eE][+-]?\d+)?$/;
    if(!raw||!(decimal.test(raw)||grouped.test(raw)))
      throw csvError(line,`${label}에 올바른 숫자가 필요합니다.`);
    const result=Number(raw.replace(/,/g,''));
    if(!Number.isFinite(result)||(count&&(!Number.isSafeInteger(result)||result<0)))
      throw csvError(line,count?`${label}는 0 이상의 안전한 정수여야 합니다.`:`${label}에 유한한 숫자가 필요합니다.`);
    return result;
  }
  function luminantTable(csvText){
    const records=csvRecords(csvText);
    if(!records.length)throw new Error('루미넌트 CSV 헤더와 세부 정산행이 없습니다.');
    const first=records[0],names=first.values.map(value=>String(value).normalize('NFC'));
    const columns=new Map();
    for(let i=0;i<names.length;i++){
      if(!names[i].trim())throw csvError(first.line,'빈 헤더가 있습니다.');
      if(columns.has(names[i]))throw csvError(first.line,`헤더 ${names[i]}이 중복되었습니다.`);
      columns.set(names[i],i);
    }
    const missing=LUMINANT_HEADERS.filter(name=>!columns.has(name));
    if(missing.length)throw csvError(first.line,`필수 헤더가 없습니다: ${missing.join(', ')}.`);
    const rows=[];
    for(const record of records.slice(1)){
      if(record.values.length!==names.length)
        throw csvError(record.line,`열 개수가 헤더와 다릅니다. 예상 ${names.length}개, 실제 ${record.values.length}개입니다.`);
      const get=name=>record.values[columns.get(name)];
      for(const label of ['아티스트명','앨범명','곡명','플랫폼명','서비스명','업체앨범코드','업체곡코드'])
        if(!text(get(label)))throw csvError(record.line,`${label}이 비어 있습니다.`);
      const albumCode=text(get('업체앨범코드')),songCode=text(get('업체곡코드'));
      if(albumCode.includes('|')||songCode.includes('|'))
        throw csvError(record.line,'업체앨범코드와 업체곡코드에는 | 문자를 사용할 수 없습니다.');
      rows.push({
        source_row_no:record.line,artist:text(get('아티스트명')),album_title:text(get('앨범명')),
        song_title:text(get('곡명')),original_platform:text(get('플랫폼명')),original_service:text(get('서비스명')),
        album_code:albumCode,song_code:songCode,original_count:csvNumber(get('카운트'),'카운트',record.line,true),
        gross_amount:csvNumber(get('인접권료'),'인접권료',record.line),
        settlement_amount:csvNumber(get('정산금액'),'정산금액',record.line),
        raw_gross_amount:get('인접권료'),raw_amount:get('정산금액'),
        notes:`업체앨범코드: ${get('업체앨범코드')} · 업체곡코드: ${get('업체곡코드')} · 인접권료: ${get('인접권료')}`
      });
    }
    if(!rows.length)throw new Error('가져올 루미넌트 세부 정산행이 없습니다.');
    const revenue=rows.reduce((sum,row)=>sum+row.settlement_amount,0);
    if(!Number.isFinite(revenue))throw new Error('루미넌트 정산금액 합계가 유한한 숫자가 아닙니다.');
    return {rows,revenue};
  }
  function inspectCsv(csvText,filename){
    const table=luminantTable(csvText);
    return {format:'luminant',label:'루미넌트 CSV 정산서',rowCount:table.rows.length,revenue:table.revenue};
  }
  function parseCsv(csvText,filename,options){
    const ym=options?.settlementYm,match=typeof ym==='string'&&ym.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    if(!match||!makeYm(Number(match[1]),Number(match[2])))
      throw new Error('루미넌트 CSV는 정산연월을 직접 지정해야 합니다. 1900~2200년의 YYYY-MM 형식으로 입력해주세요.');
    const table=luminantTable(csvText),occurrenceYm=shiftYm(ym,-3),sourceFile=text(filename);
    const rows=table.rows.map(row=>({
      ...row,import_format:'luminant',distributor:'루미넌트',source_file:sourceFile,
      settlement_year:Number(match[1]),settlement_month:Number(match[2]),settlement_ym:ym,
      occurrence_year:Number(occurrenceYm.slice(0,4)),occurrence_month:Number(occurrenceYm.slice(5,7)),occurrence_ym:occurrenceYm,
      source_key:`${row.original_platform}|${row.original_service}`,platform:row.original_platform,
      adjusted_count:null,revenue_source:'',month_song_key:`${ym}|luminant|${row.album_code}|${row.song_code}`
    }));
    const occurrences=new Map();
    for(const row of rows){
      const identity=[row.distributor,row.settlement_ym,row.artist,row.album_title,row.song_title,
        row.original_platform,row.original_service].map(decodeEntities);
      identity.push(row.original_count);
      const key=JSON.stringify(identity),groups=occurrences.get(key)||[];
      let group=groups.find(value=>Math.abs(value.amount-row.settlement_amount)<0.0000001);
      if(!group){group={amount:row.settlement_amount,codes:new Map()};groups.push(group);occurrences.set(key,groups);}
      const codeKey=JSON.stringify([row.album_code,row.song_code]);
      let code=group.codes.get(codeKey);
      if(!code){code={album:row.album_code,song:row.song_code,count:0};group.codes.set(codeKey,code);}
      row.import_occurrence=++code.count;
      // The cumulative prefix lets each D1 chunk consume legacy uncoded
      // overlaps once, while keeping different coded releases separate.
      row.import_business_prefix=Array.from(group.codes.values(),value=>[value.album,value.song,value.count]);
    }
    const result=finish(rows,[],'luminant','루미넌트 CSV 정산서');
    result.settlementYm=ym;
    return result;
  }
  function finish(rows,mappings,format,label){
    if(!rows.length)throw new Error('가져올 세부 정산행이 없습니다.');
    const dates=rows.map(row=>row.occurrence_ym).filter(Boolean).sort();
    return {rows,mappings,format,label,revenue:rows.reduce((sum,row)=>sum+(Number(row.settlement_amount)||0),0),
      minYm:dates[0]||null,maxYm:dates.at(-1)||null};
  }
  function parseWorkbook(wb,filename){
    if(!global.XLSX?.utils?.sheet_to_json)throw new Error('엑셀 파서가 로드되지 않았습니다.');
    const detail=sheet(wb,'정산내역기록');if(detail)return integrated(wb,detail,filename);
    const raw=sheet(wb,'정산서');if(raw)return minerva(raw,filename);
    throw new Error('지원하지 않는 정산서입니다. 통합 정산내역기록 또는 미네르바 정산서 XLSX를 선택해주세요.');
  }
  global.SettlementImport={parseWorkbook,inspectCsv,parseCsv};
})(typeof window!=='undefined'?window:globalThis);
