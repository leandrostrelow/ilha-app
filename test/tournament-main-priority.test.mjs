import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../torneios/index.html',import.meta.url),'utf8');
function section(start,end){const i=source.indexOf(start);assert.ok(i>=0);const j=source.indexOf(end,i+start.length);assert.ok(j>i);return source.slice(i,j);}

test('Ilha Open de tênis fica primeiro na página geral de torneios',()=>{
  const context={
    state:{snapshot:[
      {slug:'ilha-pickleball-open-2026',name:'Ilha Pickleball Open 2026'},
      {slug:'ilha-open-2026',name:'Ilha Open 2026'},
    ]},
    list:(value)=>Array.isArray(value)?value:[],
    clean:(value)=>String(value??'').trim(),
    field:(row,...names)=>names.map((name)=>row?.[name]).find((value)=>value!==undefined&&value!==null&&value!=='')??'',
  };
  vm.runInNewContext(section('function tournamentsFromSnapshot','function tournamentStatus'),context);
  const ordered=context.tournamentsFromSnapshot();
  assert.deepEqual(ordered.map((row)=>row.slug),['ilha-open-2026','ilha-pickleball-open-2026']);
  assert.equal(context.state.snapshot[0].slug,'ilha-pickleball-open-2026','não deve alterar o snapshot original');
});
