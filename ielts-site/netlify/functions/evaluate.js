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

    const jsonTemplate = `{
  "ta_label": "${taskNumber === 1 ? "Task Achievement" : "Task Response"}",
  "ta_score": 6.5,
  "ta_feedback": "2-3 sentences with specific evidence from the response.",
  "cc_score": 6.0,
  "cc_feedback": "2-3 sentences about organisation and cohesive devices.",
  "lr_score": 6.5,
  "lr_feedback": "2-3 sentences citing specific vocabulary choices or errors.",
  "gra_score": 6.0,
  "gra_feedback": "2-3 sentences identifying grammar patterns and errors.",
  "overall": 6.5,
  "summary": "3-4 sentence overall assessment starting with the candidate name.",
  "strengths": ["Specific strength 1", "Specific strength 2", "Specific strength 3"],
  "improvements": ["Most impactful improvement with example", "Second improvement", "Third improvement"],
  "corrected_example": "BEFORE: [quote from their text] → AFTER: [improved version] — reason in one sentence."
}`;

    const scoringRules = `
IELTS BAND DESCRIPTORS (half-band only: 4.0 4.5 5.0 5.5 6.0 6.5 7.0 7.5 8.0 8.5 9.0):
• Band 9: Expert, virtually no errors, full coverage, wide range
• Band 8: Very good, rare slips, well organised, wide range  
• Band 7: Good, some errors, adequately organised, good range
• Band 6: Competent, noticeable errors, adequate range, task generally addressed
• Band 5: Modest, frequent errors, limited range, task partially addressed
• Band 4: Limited, numerous errors, very limited range

WORD COUNT: ${wordCount} / minimum ${minWords}${belowMin ? " ⚠️ BELOW MINIMUM — penalise Task " + (taskNumber === 1 ? "Achievement" : "Response") + " heavily" : ""}

overall = arithmetic mean of 4 scores, rounded to nearest 0.5. Be honest, do NOT inflate scores.

Respond ONLY with valid JSON (no markdown, no backticks, no preamble):
${jsonTemplate}`;

    let messages;

    if (taskImage) {
      // ── VISION API: Task 1 with pasted image from CDI_Report ──
      const base64 = taskImage.includes(",") ? taskImage.split(",")[1] : taskImage;
      const mime = taskImageType || "image/jpeg";

      messages = [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mime, data: base64 }
          },
          {
            type: "text",
            text: `You are a senior IELTS examiner with 20 years of experience.

The image above is an IELTS Writing Task 1 question from a real recent exam (chart, graph, diagram, or map).

CANDIDATE: ${userName}
RESPONSE (${wordCount} words):
${userResponse}

First analyse what the image shows. Then score this Task 1 response against the official IELTS band descriptors.

TASK 1 CRITERIA:
• Task Achievement: All key features covered, data accurately described, clear overview, min 150 words
• Coherence & Cohesion: Logical sequence, paragraphing, cohesive devices
• Lexical Resource: Range and accuracy of vocabulary, collocations, spelling
• Grammatical Range & Accuracy: Variety of structures, frequency of errors

${scoringRules}`
          }
        ]
      }];
    } else {
      // ── TEXT API: built-in question or pasted Task 2 text ──
      const criteria = taskNumber === 1
        ? `TASK 1 CRITERIA:
• Task Achievement: Coverage of ALL key features, accurate data, clear overview, min 150 words
• Coherence & Cohesion: Logical flow, paragraphing, cohesive devices
• Lexical Resource: Vocabulary range, precision, collocations, spelling
• Grammatical Range & Accuracy: Structural variety, error frequency`
        : `TASK 2 CRITERIA:
• Task Response: Clear position, fully developed ideas, task fully addressed, min 250 words
• Coherence & Cohesion: Clear progression, logical structure, paragraphing
• Lexical Resource: Vocabulary range, precision, idiomatic language, spelling
• Grammatical Range & Accuracy: Wide range of structures, infrequent errors`;

      const prompt = `You are a senior IELTS examiner with 20 years of experience. Score this IELTS Writing Task ${taskNumber} response using official IELTS band descriptors.

CANDIDATE: ${userName}
TASK QUESTION: ${taskQuestion}

RESPONSE (${wordCount} words):
${userResponse}

${criteria}
${scoringRules}`;

      messages = [{ role: "user", content: prompt }];
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1800, messages }),
    });

    const data = await response.json();
    if (!response.ok || !data.content) throw new Error(data.error?.message || "Anthropic API xatosi");

    const raw = data.content[0].text;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("JSON topilmadi");
    const scoreData = JSON.parse(match[0]);

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: scoreData }) };

  } catch (err) {
    console.error("Evaluate error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
