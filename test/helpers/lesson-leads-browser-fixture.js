// Browser-only fixture. Never shipped by the static build and never calls a real messaging API.
if (typeof window !== 'undefined') (async () => {
  const teachers=[{id:'d0d8f795-d060-4c13-b22e-dcfd1c44a811',name:'Renato',phone:'5527992963984'},{id:'583712e1-0cac-4d8c-927b-5886123ac380',name:'Emerson',phone:''}];
  const base={revision:1,created_at:'2026-09-30T12:00:00Z',updated_at:'2026-09-30T12:00:00Z',nome:'Aluno Exemplo',telefone:'5527900000265',idade:25,publico:'Adulto',genero:'',responsavel:'',dias_disponiveis:['Terça','Quinta'],periodo:'Noite',ja_fez_aula:'Não',nivel:'',frequencia:'1x: R$250',objetivo:'Aprender do zero',como_conheceu:'Instagram',observacoes:'Cadastro fictício para teste da interface.',status:'novo',teacher_id:null,professor_nome:'',professor_telefone:'',encaminhado_em:null,proximo_contato:null,aula_em:null,anotacoes:'',source:'aulas',source_note:'',sheet_sync:'synced'};
  const leads=[{...base,id:'11111111-1111-4111-8111-111111111111'}, {...base,id:'22222222-2222-4222-8222-222222222222',nome:'Aluno Encaminhado',teacher_id:teachers[0].id,professor_nome:'Renato',professor_telefone:teachers[0].phone,status:'encaminhado',source:'planilha',source_note:'já mandei pro renato',sheet_sync:'imported'}, {...base,id:'33333333-3333-4333-8333-333333333333',nome:'Responsável de Exemplo',publico:'Criança',idade:10,responsavel:'Responsável Exemplo',status:'contato',proximo_contato:'2026-09-28'}];
  const events=[]; const original=window.fetch;
  window.fetch=async(url,options={})=>{
    if(!String(url).includes('/functions/v1/lesson-leads-api'))return original(url,options);
    const p=JSON.parse(options.body);let result={ok:true};
    if(p.action==='list')result={ok:true,leads:structuredClone(leads),total:leads.length,teachers};
    if(p.action==='detail')result={ok:true,lead:structuredClone(leads.find(l=>l.id===p.id)),events};
    if(p.action==='update'){const lead=leads.find(l=>l.id===p.id);if(lead.revision!==p.revision)return Response.json({error:'Conflito de edição.'},{status:409});Object.assign(lead,p,{revision:p.revision+1});if(p.confirm_forward)lead.encaminhado_em=new Date().toISOString();events.unshift({id:crypto.randomUUID(),created_at:new Date().toISOString(),kind:'atualizacao',detail:'Atendimento de teste atualizado.'});}
    window.__leadFixtureRequests=(window.__leadFixtureRequests||[]).concat(p.action);
    return Response.json(result);
  };
  window.IlhaLeadsAdmin.open({supabaseUrl:'https://fixture.invalid',publishableKey:'fixture',getSession:()=>({access_token:'fixture-token'}),notify:message=>{window.__leadFixtureToast=message;}});
})();
