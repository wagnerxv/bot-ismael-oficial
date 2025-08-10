// api/index.js

const express = require('express');
const axios = require('axios');
const moment = require('moment');
const { createClient } = require('@vercel/kv');
const { MOTORISTA_CONFIG, LOCAIS_CONFIG, MULTIPLICADOR_PASSAGEIROS } = require('../data/config.js');

const app = express();
app.use(express.json());

// --- Variáveis de Ambiente (Configure na Vercel) ---
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_API_VERSION = 'v19.0';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const MOTORISTA_WHATSAPP_NUMBER = `55${MOTORISTA_CONFIG.telefone.replace(/\D/g, '')}`;

const kv = createClient({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// --- Rota de Verificação do Webhook ---
app.get('/api/webhook', (req, res) => {
  console.log('Recebida verificação de webhook...');
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    console.log('Webhook verificado com sucesso!');
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error('Falha na verificação do webhook. Tokens não correspondem.');
    res.status(403).send('Forbidden');
  }
});

// --- Rota para Receber Mensagens ---
app.post('/api/webhook', async (req, res) => {
  const data = req.body;
  
  try {
    if (data.object === 'whatsapp_business_account') {
      const entry = data.entry?.[0];
      if (entry && entry.changes) {
        const change = entry.changes[0];
        if (change.field === 'messages' && change.value.messages) {
          const message = change.value.messages[0];
          const from = message.from;
          
          let userResponse;
          let messageType = message.type;

          if (messageType === 'text') {
            userResponse = message.text.body;
          } else if (messageType === 'interactive') {
            const interactive = message.interactive;
            userResponse = interactive.button_reply ? interactive.button_reply.id : interactive.list_reply.id;
          }

          if (userResponse) {
            console.log(`Mensagem recebida de ${from}: "${userResponse}"`);
            await processarMensagem(from, userResponse, messageType);
          }
        }
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    console.error('Erro no webhook principal:', error);
    res.status(500).send('Internal Server Error');
  }
});


// --- Lógica Principal do Chatbot ---
async function processarMensagem(de, mensagem, tipoMensagem) {
  let sessao = await kv.get(de) || { etapa: 'boas_vindas', dados: {} };
  
  if (mensagem.toLowerCase() === 'cancelar') {
    await kv.del(de);
    await enviarMensagem(de, { type: 'text', text: { body: '❌ Atendimento cancelado. Se precisar de algo, é só chamar!' } });
    return;
  }

  // Lógica para quando o bot espera um texto livre
  const esperaTexto = ['aguardando_origem_texto', 'aguardando_destino_texto', 'aguardando_nome', 'aguardando_contato'].includes(sessao.etapa);
  if (esperaTexto && tipoMensagem === 'text') {
     switch (sessao.etapa) {
        case 'aguardando_origem_texto':
            sessao.dados.origem = mensagem;
            sessao.etapa = 'destino';
            await sessaoDestino(de, sessao);
            break;
        case 'aguardando_destino_texto':
            sessao.dados.destino = mensagem;
            sessao.etapa = 'passageiros';
            await sessaoPassageiros(de, sessao);
            break;
        case 'aguardando_nome':
            sessao.dados.nomeCliente = mensagem;
            sessao.etapa = 'aguardando_contato';
            await enviarMensagem(de, { type: 'text', text: { body: `Obrigado, ${mensagem}!\n\n📱 Agora, por favor, informe um número de telefone para contato (com DDD).` } });
            break;
        case 'aguardando_contato':
            sessao.dados.contatoCliente = mensagem;
            await sessaoFinal(de, sessao);
            return; // Finaliza o fluxo
     }
  } else { // Lógica para cliques em botões/listas ou início de conversa
    switch (sessao.etapa) {
      case 'boas_vindas':
        await sessaoBoasVindas(de, sessao);
        break;
      case 'aguardando_inicio':
        await processarOpcaoInicial(de, mensagem, sessao);
        break;
      case 'origem':
        await sessaoOrigem(de, sessao);
        break;
      case 'aguardando_origem':
        await processarEscolhaOrigem(de, mensagem, sessao);
        break;
      case 'destino':
        await sessaoDestino(de, sessao);
        break;
      case 'aguardando_destino':
        await processarEscolhaDestino(de, mensagem, sessao);
        break;
      case 'passageiros':
        await sessaoPassageiros(de, sessao);
        break;
      case 'aguardando_passageiros':
        await processarEscolhaPassageiros(de, mensagem, sessao);
        break;
      case 'confirmacao':
        await processarConfirmacao(de, mensagem, sessao);
        break;
    }
  }
  
  await kv.set(de, sessao);
}


// --- Funções de Etapa do Fluxo ---

async function sessaoBoasVindas(de, sessao) {
  sessao.etapa = 'aguardando_inicio';
  const payload = {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: `🚗 *Olá! Eu sou o Ismael!*\nMotorista particular em *${MOTORISTA_CONFIG.cidade}*.\n\nComo posso te ajudar hoje?` },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'fazer_cotacao', title: '🎯 Fazer Cotação' } },
          { type: 'reply', reply: { id: 'ver_precos', title: '💰 Ver Preços' } },
          { type: 'reply', reply: { id: 'contato_direto', title: '📞 Contato Direto' } }
        ]
      }
    }
  };
  await enviarMensagem(de, payload);
}

async function processarOpcaoInicial(de, mensagem, sessao) {
    switch (mensagem) {
        case 'fazer_cotacao':
            sessao.etapa = 'origem';
            await sessaoOrigem(de, sessao);
            break;
        case 'ver_precos':
            await mostrarTabelaPrecos(de);
            await sessaoBoasVindas(de, sessao);
            break;
        case 'contato_direto':
            await enviarContato(de);
            await sessaoBoasVindas(de, sessao);
            break;
    }
}

async function sessaoOrigem(de, sessao) {
    sessao.etapa = 'aguardando_origem';
    const sections = [
        { title: '🏢 Locais Urbanos', rows: Object.keys(LOCAIS_CONFIG.urbanos).map(l => ({ id: `loc_${l}`, title: l })) },
        { title: '🌾 Zona Rural', rows: Object.keys(LOCAIS_CONFIG.rurais).map(l => ({ id: `loc_${l}`, title: l })) },
        { title: '📝 Outro', rows: [{ id: 'outro_local', title: '✏️ Digitar outro endereço' }] }
    ];
    const payload = {
        type: 'interactive',
        interactive: {
            type: 'list',
            header: { type: 'text', text: 'Ponto de Partida' },
            body: { text: 'Selecione seu local de partida na lista ou escolha a opção para digitar um endereço.' },
            footer: { text: 'Ismael Motorista' },
            action: { button: 'Ver Locais', sections }
        }
    };
    await enviarMensagem(de, payload);
}

async function processarEscolhaOrigem(de, mensagem, sessao) {
    if (mensagem === 'outro_local') {
        sessao.etapa = 'aguardando_origem_texto';
        await enviarMensagem(de, { type: 'text', text: { body: 'Por favor, digite o endereço de partida:' } });
    } else {
        sessao.dados.origem = mensagem.replace('loc_', '');
        sessao.etapa = 'destino';
        await sessaoDestino(de, sessao);
    }
}

async function sessaoDestino(de, sessao) {
    sessao.etapa = 'aguardando_destino';
    const sections = [
        { title: '🏢 Locais Urbanos', rows: Object.keys(LOCAIS_CONFIG.urbanos).map(l => ({ id: `loc_${l}`, title: l })) },
        { title: '🌾 Zona Rural', rows: Object.keys(LOCAIS_CONFIG.rurais).map(l => ({ id: `loc_${l}`, title: l })) },
        { title: '🏙️ Cidades Vizinhas', rows: Object.keys(LOCAIS_CONFIG.vizinhas).map(l => ({ id: `loc_${l}`, title: l })) },
        { title: '📝 Outro', rows: [{ id: 'outro_local', title: '✏️ Digitar outro endereço' }] }
    ];
    const payload = {
        type: 'interactive',
        interactive: {
            type: 'list',
            header: { type: 'text', text: 'Destino da Viagem' },
            body: { text: `Origem: *${sessao.dados.origem}*\n\nSelecione o destino na lista ou escolha a opção para digitar.` },
            action: { button: 'Ver Destinos', sections }
        }
    };
    await enviarMensagem(de, payload);
}

async function processarEscolhaDestino(de, mensagem, sessao) {
    if (mensagem === 'outro_local') {
        sessao.etapa = 'aguardando_destino_texto';
        await enviarMensagem(de, { type: 'text', text: { body: 'Por favor, digite o endereço de destino:' } });
    } else {
        sessao.dados.destino = mensagem.replace('loc_', '');
        sessao.etapa = 'passageiros';
        await sessaoPassageiros(de, sessao);
    }
}

async function sessaoPassageiros(de, sessao) {
    sessao.etapa = 'aguardando_passageiros';
    const payload = {
        type: 'interactive',
        interactive: {
            type: 'button',
            body: { text: '👥 Quantas pessoas vão viajar?' },
            action: {
                buttons: [
                    { type: 'reply', reply: { id: 'pass_1', title: '1 Passageiro' } },
                    { type: 'reply', reply: { id: 'pass_2', title: '2 Passageiros' } },
                    { type: 'reply', reply: { id: 'pass_3', title: '3 ou mais' } },
                ]
            }
        }
    };
    await enviarMensagem(de, payload);
}

async function processarEscolhaPassageiros(de, mensagem, sessao) {
    sessao.dados.passageiros = parseInt(mensagem.replace('pass_', ''));
    await mostrarCotacao(de, sessao);
}

async function mostrarCotacao(de, sessao) {
    sessao.etapa = 'confirmacao';
    const cotacao = calcularCotacao(sessao.dados);
    sessao.dados.cotacao = cotacao;

    const textoCotacao = `💰 *COTAÇÃO DA VIAGEM*\n\n` +
        `📍 *Origem:* ${sessao.dados.origem}\n` +
        `🎯 *Destino:* ${sessao.dados.destino}\n` +
        `👥 *Passageiros:* ${sessao.dados.passageiros}\n\n` +
        `💵 *Valor Base:* R$ ${cotacao.valorBase.toFixed(2)}\n` +
        `${cotacao.acrescimo > 0 ? `➕ *Acréscimo:* R$ ${cotacao.acrescimo.toFixed(2)}\n` : ''}` +
        `💰 *VALOR TOTAL: R$ ${cotacao.valorTotal.toFixed(2)}*\n` +
        `⏱️ *Tempo Estimado:* ${cotacao.tempoEstimado} minutos\n\n` +
        `Tudo certo para confirmar?`;

    const payload = {
        type: 'interactive',
        interactive: {
            type: 'button',
            body: { text: textoCotacao },
            action: {
                buttons: [
                    { type: 'reply', reply: { id: 'confirmar_viagem', title: '✅ Confirmar' } },
                    { type: 'reply', reply: { id: 'fazer_cotacao', title: '🔄 Nova Cotação' } },
                ]
            }
        }
    };
    await enviarMensagem(de, payload);
}

async function processarConfirmacao(de, mensagem, sessao) {
    if (mensagem === 'confirmar_viagem') {
        sessao.etapa = 'aguardando_nome';
        await enviarMensagem(de, { type: 'text', text: { body: '📝 *Ótimo! Para finalizar, qual o seu nome completo?*' } });
    } else if (mensagem === 'fazer_cotacao') {
        sessao.etapa = 'boas_vindas';
        sessao.dados = {};
        await sessaoBoasVindas(de, sessao);
    }
}

async function sessaoFinal(de, sessao) {
    const corrida = {
        id: Date.now(),
        dataHora: moment().format('DD/MM/YYYY HH:mm:ss'),
        cliente: {
            nome: sessao.dados.nomeCliente,
            contato: sessao.dados.contatoCliente,
            whatsapp: de
        },
        origem: sessao.dados.origem,
        destino: sessao.dados.destino,
        passageiros: sessao.dados.passageiros,
        valorTotal: sessao.dados.cotacao.valorTotal,
        tempoEstimado: sessao.dados.cotacao.tempoEstimado,
        status: 'confirmada'
    };
    
    await kv.set(`corrida:${corrida.id}`, corrida);

    const confirmacaoFinalCliente = `✅ *VIAGEM CONFIRMADA!*\n\n` +
        `Obrigado, ${corrida.cliente.nome}! Estarei no local de partida em breve.\n\n` +
        `*Resumo:*\n` +
        `*De:* ${corrida.origem}\n` +
        `*Para:* ${corrida.destino}\n` +
        `*Valor:* R$ ${corrida.valorTotal.toFixed(2)}\n\n` +
        `*Motorista:* ${MOTORISTA_CONFIG.nome}\n` +
        `*Veículo:* ${MOTORISTA_CONFIG.veiculo.modelo} (${MOTORISTA_CONFIG.veiculo.placa})\n` +
        `*PIX:* ${MOTORISTA_CONFIG.pix}`;
    await enviarMensagem(de, { type: 'text', text: { body: confirmacaoFinalCliente } });
    
    await notificarMotorista(corrida);

    await kv.del(de);
}

// --- Funções Auxiliares ---
function calcularCotacao(dados) {
    let valorBase = 30;
    let tempoEstimado = 20;
    const todosLocais = { ...LOCAIS_CONFIG.urbanos, ...LOCAIS_CONFIG.rurais, ...LOCAIS_CONFIG.vizinhas };
    if (todosLocais[dados.destino]) {
        valorBase = todosLocais[dados.destino].preco;
        tempoEstimado = todosLocais[dados.destino].tempo;
    }
    const multiplicador = MULTIPLICADOR_PASSAGEIROS[dados.passageiros] || 1.4;
    const valorTotal = valorBase * multiplicador;
    const acrescimo = valorTotal - valorBase;
    return { valorBase, acrescimo, valorTotal, tempoEstimado };
}

async function notificarMotorista(corrida) {
    const notificacao = `🔔 *NOVA CORRIDA CONFIRMADA* 🔔\n\n` +
        `*Cliente:* ${corrida.cliente.nome}\n` +
        `*Contato:* ${corrida.cliente.contato}\n` +
        `*WhatsApp:* wa.me/${corrida.cliente.whatsapp.split('@')[0]}\n\n` +
        `*Origem:* ${corrida.origem}\n` +
        `*Destino:* ${corrida.destino}\n` +
        `*Passageiros:* ${corrida.passageiros}\n` +
        `*Valor:* R$ ${corrida.valorTotal.toFixed(2)}\n` +
        `*Horário:* ${corrida.dataHora}`;
    await enviarMensagem(MOTORISTA_WHATSAPP_NUMBER, { type: 'text', text: { body: notificacao } });
}

async function mostrarTabelaPrecos(de) {
    const tabela = `💰 *TABELA DE PREÇOS (BASE)*\n\n` +
        `*Urbanos:* a partir de R$ 15,00\n` +
        `*Rurais:* a partir de R$ 35,00\n` +
        `*Cidades Vizinhas:* a partir de R$ 75,00\n\n` +
        `*Acréscimos por Passageiros:*\n` +
        `• 3 ou mais: +20%`;
    await enviarMensagem(de, { type: 'text', text: { body: tabela } });
}

async function enviarContato(de) {
    const contato = `📞 *CONTATO DIRETO*\n\n` +
        `*Nome:* ${MOTORISTA_CONFIG.nome}\n` +
        `*WhatsApp/Telefone:* ${MOTORISTA_CONFIG.telefone}\n` +
        `*PIX:* ${MOTORISTA_CONFIG.pix}`;
    await enviarMensagem(de, { type: 'text', text: { body: contato } });
}

// --- Função Genérica de Envio ---
async function enviarMensagem(para, payload) {
  try {
    await axios.post(`https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`, 
    {
      messaging_product: 'whatsapp',
      to: para,
      ...payload
    }, 
    {
      headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
    });
  } catch (error) {
    console.error(`Erro ao enviar mensagem para ${para}:`, error.response?.data || error.message);
  }
}

module.exports = app;
