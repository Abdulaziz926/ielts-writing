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
IELTS BAND DESCRIPTORS (half-band only: 4.0 4.5 5.0 5.5 6.0 6.5 7.0 7.5 8.0 8.5 9.0):
- Band 9: Expert, virtually no errors, full coverage, wide range
- Band 8: Very good, rare slips, well organised, wide range
- Band 7: Good, some errors, adequately organised, good range
- Band 6: Competent, noticeable errors, adequate range, task generally addressed
- Band 5: Modest, frequent errors, limited range, task partially addressed
- Band 4: Limited, numerous errors, very limited range

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

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: jsonSchema,
          temperature: 0.4,
          maxOutputTokens: 2000
        }
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || "Gemini API xatosi");
    }

    const candidate = data.candidates && data.candidates[0];
    if (!candidate || !candidate.content || !candidate.content.parts || !candidate.content.parts[0]) {
      throw new Error("Gemini javob bermadi (bo'sh javob)");
    }

    const raw = candidate.content.parts[0].text;
    const scoreData = JSON.parse(raw);

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: scoreData }) };

  } catch (err) {
    console.error("Evaluate error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
