exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { taskNumber, taskQuestion, userResponse, userName, taskImage, taskImageType } = JSON.parse(event.body);
    const words = userResponse.trim().split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;
    const minWords = taskNumber === 1 ? 150 : 250;
    const belowMin = wordCount < minWords;

    const jsonSchema = {
      type: "object",
      properties: {
        ta_label: { type: "string" },
        ta_score: { type: "number" },
        ta_feedback: { type: "string" },
        cc_score: { type: "number" },
        cc_feedback: { type: "string" },
        lr_score: { type: "number" },
        lr_feedback: { type: "string" },
        gra_score: { type: "number" },
        gra_feedback: { type: "string" },
        overall: { type: "number" },
        summary: { type: "string" },
        strengths: { type: "array", items: { type: "string" } },
        improvements: { type: "array", items: { type: "string" } },
        corrected_example: { type: "string" }
      },
      required: ["ta_label","ta_score","ta_feedback","cc_score","cc_feedback","lr_score","lr_feedback","gra_score","gra_feedback","overall","summary","strengths","improvements","corrected_example"]
    };

    const scoringRules = `
CRITICAL FIRST CHECK — read this before scoring anything:
If the response is random characters/keyboard mashing (e.g. "afaf aevvv"), is totally unrelated to the task topic, is essentially blank, is copied/memorised text unconnected to the question, or contains no coherent English sentences at all — this is official IELTS "Band 0: No rateable language". In this exact case:
- Set ta_score, cc_score, lr_score, gra_score, and overall ALL to 0 (not 4, not any other number)
- ta_feedback/summary must explicitly state in simple words that this is not a valid attempt — e.g. "This response consists of random characters/words with no rateable English language, so it cannot be scored."
- strengths must be exactly ["None — no valid attempt was made"]
- Skip the band descriptors below entirely for this case.

If the response IS a genuine attempt at the task (even if very weak, short, or full of errors), score normally using the official band descriptors below. Do NOT use Band 0 just because the response is weak, short, or has many errors — Band 0 is ONLY for no rateable language / totally irrelevant / blank responses.

IELTS BAND DESCRIPTORS for genuine attempts (half-band only: 4.0 4.5 5.0 5.5 6.0 6.5 7.0 7.5 8.0 8.5 9.0):
- Band 9: Expert, virtually no errors, full coverage, wide range
- Band 8: Very good, rare slips, well organised, wide range
- Band 7: Good, some errors, adequately organised, good range
- Band 6: Competent, noticeable errors, adequate range, task generally addressed
- Band 5: Modest, frequent errors, limited range, task partially addressed
- Band 4: Limited, numerous errors, very limited range, but IS a genuine relevant attempt

WORD COUNT: ${wordCount} / minimum ${minWords}${belowMin ? " WARNING: BELOW MINIMUM - penalise " + (taskNumber === 1 ? "Task Achievement" : "Task Response") + " heavily" : ""}

overall = arithmetic mean of the 4 criteria scores, rounded to nearest 0.5. Be honest, do NOT inflate scores. Write all feedback in clear, simple English.`;

    let parts;
    let promptText;

    if (taskImage) {
      const base64 = taskImage.includes(",") ? taskImage.split(",")[1] : taskImage;
      const mime = taskImageType || "image/jpeg";

      promptText = `You are a senior IELTS examiner with 20 years of experience.

The attached image is an IELTS Writing Task 1 question from a real recent exam (chart, graph, diagram, table, or map).

CANDIDATE: ${userName}
RESPONSE (${wordCount} words):
${userResponse}

First analyse what the image shows. Then score this Task 1 response against the official IELTS band descriptors.

TASK 1 CRITERIA:
- Task Achievement: All key features covered, data accurately described, clear overview, min 150 words
- Coherence & Cohesion: Logical sequence, paragraphing, cohesive devices
- Lexical Resource: Range and accuracy of vocabulary, collocations, spelling
- Grammatical Range & Accuracy: Variety of structures, frequency of errors

${scoringRules}

ta_label field must be exactly "Task Achievement".`;

      parts = [
        { text: promptText },
        { inline_data: { mime_type: mime, data: base64 } }
      ];
    } else {
      const criteria = taskNumber === 1
        ? `TASK 1 CRITERIA:
- Task Achievement: Coverage of ALL key features, accurate data, clear overview, min 150 words
- Coherence & Cohesion: Logical flow, paragraphing, cohesive devices
- Lexical Resource: Vocabulary range, precision, collocations, spelling
- Grammatical Range & Accuracy: Structural variety, error frequency`
        : `TASK 2 CRITERIA:
- Task Response: Clear position, fully developed ideas, task fully addressed, min 250 words
- Coherence & Cohesion: Clear progression, logical structure, paragraphing
- Lexical Resource: Vocabulary range, precision, idiomatic language, spelling
- Grammatical Range & Accuracy: Wide range of structures, infrequent errors`;

      promptText = `You are a senior IELTS examiner with 20 years of experience. Score this IELTS Writing Task ${taskNumber} response using official IELTS band descriptors.

CANDIDATE: ${userName}
TASK QUESTION: ${taskQuestion}

RESPONSE (${wordCount} words):
${userResponse}

${criteria}
${scoringRules}

ta_label field must be exactly "${taskNumber === 1 ? "Task Achievement" : "Task Response"}".`;

      parts = [{ text: promptText }];
    }

    const model = "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    async function callGemini() {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: jsonSchema,
            temperature: 0.4,
            maxOutputTokens: 4096
          }
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || "Gemini API xatosi");
      }

      const candidate = data.candidates && data.candidates[0];
      if (!candidate || !candidate.content || !candidate.content.parts || !candidate.content.parts[0]) {
        const reason = candidate?.finishReason || "noma'lum";
        throw new Error("Gemini bo'sh javob qaytardi (sabab: " + reason + ")");
      }

      const raw = candidate.content.parts[0].text;
      return JSON.parse(raw);
    }

    let scoreData;
    try {
      scoreData = await callGemini();
    } catch (firstErr) {
      console.error("Birinchi urinish muvaffaqiyatsiz:", firstErr.message);
      // Javob uzilib qolgan yoki JSON buzilgan bo'lishi mumkin — bir marta qayta urinamiz
      scoreData = await callGemini();
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: scoreData }) };

  } catch (err) {
    console.error("Evaluate error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
