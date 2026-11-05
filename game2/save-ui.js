import {exportSave,parseSave} from './campaign-save.js';

export function createSaveUI({saves,getState,onRestore,info,onBack,storageManager=globalThis.navigator?.storage}){
 const describe=record=>`${record.campaign.name} · ${record.campaign.wins.length}/6 selos${record.campaign.champion?' · ★ Mistério resolvido':''}\n${new Date(record.savedAt).toLocaleString('pt-BR')}`;
 const file=document.createElement('input');file.type='file';file.accept='.json,application/json';file.hidden=true;document.body.append(file);
 function download(){
  const state=getState(),blob=new Blob([exportSave(state)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`ilha-misterio-${state.name.replace(/[^a-z0-9-]/gi,'-')||'save'}-${new Date().toISOString().slice(0,10)}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function preview(record){
  info('Restaurar esta aventura?',`${describe(record)}\n\nEla vai substituir a aventura em uso. Sua aventura atual ficará na lista de cópias locais; baixe um backup antes, por segurança. O ranking online não muda.`,[
   ['Baixar meu save atual',download],['Confirmar restauração',async()=>{saves.restore(record);onRestore(record.campaign);await saves.flush();open(saves.status().saved?'Aventura restaurada!':'Aventura carregada, mas não foi possível gravá-la. Baixe um backup antes de sair.');}],['Cancelar',open],
  ]);
 }
 file.addEventListener('change',async()=>{const selected=file.files?.[0];file.value='';if(!selected)return;
  try{if(selected.size>128*1024)throw new Error('Escolha o arquivo .json de backup do jogo (até 128 KB).');preview(parseSave(await selected.text()));}
  catch(error){open(error.message);}
 });
 function history(){const rows=saves.history();info('Cópias de recuperação','As últimas quatro versões diferentes ficam neste navegador. Escolha uma para conferir antes de restaurar.',[...rows.map((r,i)=>[`${i===0?'Atual':'Cópia '+i} · ${describe(r)}`,()=>preview(r)]),['Voltar',open]]);}
 function open(message=''){
  const state=saves.status(),hasGame=getState().begun;
  info('Save e backup',`${typeof message==='string'&&message?message+'\n\n':''}${state.conflict?'Outra aba salvou uma versão mais nova. Baixe o progresso desta aba antes de recarregar.':state.saved?'Salvamento automático neste aparelho.':'Atenção: este navegador não está conseguindo salvar!'}${state.recovered?'\nUma cópia local recuperou seu progresso.':''}\n\nSalvamos após missões, aulas, itens e resultados. A partida em andamento recomeça ao fechar o app.\n\nNão há sincronização na conta/nuvem. As cópias locais ajudam se um registro falhar, mas limpar os dados do navegador, usar modo privado ou trocar de aparelho pode apagar o save.\n\nBaixe um backup e guarde em Arquivos, iCloud ou Drive. Você pode restaurar esse arquivo em outro aparelho. O backup contém só sua aventura, sem dados de login.`,[
   ...(hasGame?[['Baixar backup (.json)',download]]:[]),['Restaurar arquivo de backup',()=>file.click()],...(saves.history().length>1?[['Ver cópias de recuperação',history]]:[]),
   ...(storageManager?.persist?[['Pedir proteção ao navegador',async()=>{let granted=false;try{granted=await storageManager.persist();}catch{/* Explain denial instead of promising protection. */}open(granted?'Proteção contra limpeza automática concedida. Ainda baixe um backup: apagar dados manualmente continua apagando o save.':'O navegador não concedeu proteção extra. Você ainda pode baixar um backup.');}]]:[]),['Voltar às opções',onBack],
  ]);
 }
 return {open,download};
}
