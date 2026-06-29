exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const { taskNumber, taskQuestion, userResponse, userName } = JSON.parse(
      event.body
    );

    const words = userResponse
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    const wordCount = words.length;
    const minWords = taskNumber === 1 ? 150 : 250;
    const isBelowMinimum = wordCount < minWords;

    const criteriaBlock =
      taskNumber === 1
        ? `TASK 1 BAND DESCRIPTORS:
• Task Achievement (TA): Coverage of ALL key features; accurate, relevant data; clear overview/summary; minimum 150 words
• Coherence & Cohesion (CC): Logical information flow; paragraphing; range and accuracy of cohesive devices  
• Lexical Resource (LR): Vocabulary range; precision; collocations; uncommon lexis; spelling accuracy
• Grammatical Range & Accuracy (GRA): Variety of clause and sentence structures; frequency and impact of errors`
        : `TASK 2 BAND DESCRIPTORS:
• Task Response (TR): Clear position; fully extended, relevant ideas; task fully addressed; minimum 250 words
• Coherence & Cohesion (CC): Clear progression; logical structure; appropriate paragraphing; cohesive devices
• Lexical Resource (LR): Range and precision of vocabulary; collocations; idiomatic language; spelling
• Grammatical Range & Accuracy (GRA): Wide range of structures; infrequent, minor errors only`;

    const prompt = `You are a senior IELTS examiner with 20 years of experience. Score this IELTS Writing Task ${taskNumber} response using the official IELTS public band descriptors (0–9, half-band increments only: 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0).

CANDIDATE NAME: ${userName}
WORD COUNT: ${wordCount} (minimum required: ${minWords})${isBelowMinimum ? " ⚠️ BELOW MINIMUM — penalise Task " + (taskNumber === 1 ? "Achievement" : "Response") + " significantly" : ""}

TASK QUESTION:
${taskQuestion}

CANDIDATE RESPONSE:
${userResponse}

${criteriaBlock}

SCORING GUIDELINES (representative anchors):
Band 9: Expert; virtually no errors; full task coverage; wide range of vocabulary and complex structures
Band 8: Very good; rare slips; well-organised; wide range; most of the task fully addressed  
Band 7: Good; some errors; adequately organised; good range; main parts of task addressed
Band 6: Competent; noticeable errors; some organisation; adequate range; task generally addressed
Band 5: Modest; frequent errors; limited organisation; limited range; task partially addressed
Band 4: Limited; numerous errors; minimal organisation; very limited range; task only partially addressed

Respond with ONLY a valid JSON object (no markdown, no backticks, no preamble):
{
  "ta_label": "${taskNumber === 1 ? "Task Achievement" : "Task Response"}",
  "ta_score": 6.5,
  "ta_feedback": "Exactly 2–3 sentences with specific evidence from the response. Quote or paraphrase actual phrases used.",
  "cc_score": 6.0,
  "cc_feedback": "Exactly 2–3 sentences with specific evidence. Mention paragraph structure and cohesive devices used.",
  "lr_score": 6.5,
  "lr_feedback": "Exactly 2–3 sentences. Cite specific vocabulary choices, collocations, or errors found.",
  "gra_score": 6.0,
  "gra_feedback": "Exactly 2–3 sentences. Identify grammar range and specific error patterns observed.",
  "overall": 6.5,
  "summary": "3–4 sentences overall assessment. Start with the candidate's name. Be specific about their level.",
  "strengths": ["Specific strength with example from text", "Second specific strength", "Third specific strength"],
  "improvements": ["Most impactful change needed, with example", "Second improvement with specific guidance", "Third improvement"],
  "corrected_example": "Pick ONE sentence from their text that has an error or could be improved. Show BEFORE → AFTER and explain why in one sentence."
}

IMPORTANT: overall = arithmetic mean of the four criteria scores, rounded to nearest 0.5. Be honest and rigorous — do not inflate scores.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1800,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.content) {
      throw new Error(data.error?.message || "Anthropic API error");
    }

    const rawText = data.content[0].text;

    // Robust JSON extraction
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in model response");

    const scoreData = JSON.parse(jsonMatch[0]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: scoreData }),
    };
  } catch (err) {
    console.error("Evaluate function error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
