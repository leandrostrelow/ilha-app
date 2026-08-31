# Operações de segurança

## Rotação da rede Wi-Fi

Uma senha Wi-Fi já esteve presente em uma versão anterior do repositório. O
valor foi removido do código atual, mas permanece no histórico Git; portanto,
deve ser considerado comprometido. Não copie o valor antigo para issues,
commits, mensagens ou relatórios.

Procedimento:

1. No painel do roteador/controlador, gere uma nova senha aleatória e exclusiva
   com no mínimo 16 caracteres e mantenha WPA2-AES ou WPA3 habilitado.
2. Revogue sessões/dispositivos convidados quando o equipamento permitir e
   aplique a nova credencial.
3. Atualize os dispositivos autorizados por canal seguro. No ADM, informe a
   senha somente no prompt temporário de impressão; o sistema não a armazena.
4. Teste que a credencial anterior não autentica mais e registre somente data,
   responsável e resultado da rotação — nunca a senha.
5. Revise logs, backups exportados e artefatos impressos antigos conforme a
   política do clube.

Reescrever o histórico Git é opcional após a rotação e exige coordenação com
todos os clones e deploys. Isso não substitui a troca da senha, que é a ação
obrigatória.
