const Groq = require('groq-sdk');
const OpenAI = require('openai');
const mcpHub = require('../../mcpHub');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

const MODELO_OPENROUTER_ROUTER = 'openrouter/free';
const MODELO_GROQ_PADRAO = 'openai/gpt-oss-20b';

async function processarResposta(mensagens, usarVisao = false, imageUrl = null) {
  if (usarVisao && imageUrl) {
    try {
      const completionVisao = await openrouter.chat.completions.create({
        model: 'meta-llama/llama-3.2-11b-vision-instruct:free',
        messages: [
          mensagens[0],
          {
            role: 'user',
            content: [
              { type: 'text', text: mensagens[mensagens.length - 1].content },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ]
      });
      return completionVisao.choices[0]?.message?.content || 'olhei a foto mas fiquei sem palavras kkk 🌸';
    } catch (err) {
      console.warn('[Visão] Falha no modelo de visão, caindo para o fluxo normal...');
    }
  }

  let limiteLoop = 5;

  while (limiteLoop > 0) {
    limiteLoop--;
    let resposta = null;

    try {
      const completion = await openrouter.chat.completions.create({
        model: MODELO_OPENROUTER_ROUTER,
        messages: mensagens,
        tools: mcpHub.ferramentas.length > 0 ? mcpHub.ferramentas : undefined,
      });
      resposta = completion.choices[0]?.message;
    } catch (err) {
      console.warn(`[OpenRouter] Falha (${err.message}). Usando backup Groq...`);

      try {
        const completionGroq = await groq.chat.completions.create({
          model: MODELO_GROQ_PADRAO,
          messages: mensagens,
          tools: mcpHub.ferramentas.length > 0 ? mcpHub.ferramentas : undefined,
        });
        resposta = completionGroq.choices[0]?.message;
      } catch (errGroq) {
        console.error('[Groq] Erro no backup:', errGroq.message);
        throw errGroq;
      }
    }

    if (!resposta || !resposta.tool_calls || resposta.tool_calls.length === 0) {
      return resposta?.content || 'vix, deu um branco aqui... fala de novo? 🥺';
    }

    mensagens.push(resposta);

    for (const toolCall of resposta.tool_calls) {
      const nomeFerramenta = toolCall.function.name;
      const argumentos = JSON.parse(toolCall.function.arguments);

      console.log(`⚙️ [MCP Local] Mimi acionou: ${nomeFerramenta}`);

      try {
        const resultado = await mcpHub.executarFerramenta(nomeFerramenta, argumentos);
        mensagens.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: resultado,
        });
      } catch (err) {
        mensagens.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: err.message }),
        });
      }
    }
  }

  return 'eita, pesquisei tanta coisa que até me perdi um pouco kkkk pergunta de novo? 🌸';
}

module.exports = { processarResposta };