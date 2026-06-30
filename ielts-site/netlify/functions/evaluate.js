exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { taskNumber, taskQuestion, userResponse, userName, taskImage, taskImageType, chartData } = JSON.parse(event.body);
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
        corrected_example: { type: "string" },
        fact_errors: { type: "array", items: { type: "string" } }
      },
      required: ["ta_label","ta_score","ta_feedback","cc_score","cc_feedback","lr_score","lr_feedback","gra_score","gra_feedback","overall","summary","strengths","improvements","corrected_example","fact_errors"]
    };

    // ─────────────────────────────────────────────────────────
    // FULL OFFICIAL IELTS BAND DESCRIPTORS (paraphrased from the
    // public IELTS.org Task 1 / Task 2 Band Descriptor tables)
    // ─────────────────────────────────────────────────────────
    const T1_BANDS = `
OFFICIAL TASK 1 BAND DESCRIPTORS (use these to anchor every score):

Band 9 — TA: fully and appropriately satisfies all requirements; only extremely rare minor lapses. CC: message follows effortlessly; cohesion barely noticeable; paragraphing skilful. LR: full flexibility and precise, natural vocabulary; minor spelling/word-formation slips are extremely rare. GRA: wide range of structures used with full flexibility and control; virtually error-free.

Band 8 — TA: covers all requirements appropriately and sufficiently; key features/bullet points skilfully selected and clearly presented; only occasional minor omissions. CC: logically sequenced, well-managed cohesion, occasional minor lapses, good paragraphing. LR: wide resource used fluently and flexibly; skilful use of less common/idiomatic items; occasional inaccuracies that barely affect meaning. GRA: wide range of structures, majority of sentences error-free, only occasional non-systematic errors.

Band 7 — TA: covers the requirements; content relevant and mostly accurate with a few omissions; key features/bullet points covered and clearly highlighted but could be more fully extended; clear overview present with data appropriately categorised. CC: logically organised with clear progression; cohesive devices used flexibly with some inaccuracy or over/under-use. LR: sufficient range for some flexibility and precision; some less common/idiomatic items used; only a few spelling/word-formation errors. GRA: mix of simple and complex sentences; complex ones less accurate than simple ones; errors occur but rarely impede communication.

Band 6 — TA: focuses on task requirements with appropriate format; key features/bullet points appropriately highlighted but overview may be only partly relevant; some irrelevant/inaccurate detail, or missing/excessive detail. CC: organisation evident but not wholly logical; some lack of overall progression though underlying coherence is sensed; ideas followable but not always fluently linked; cohesive devices sometimes inaccurate, limited or overused. LR: generally adequate vocabulary; meaning clear despite restricted range or imprecision; some spelling/word-formation errors that don't impede communication. GRA: limited and somewhat repetitive range; complex sentences attempted but often faulty; frequent errors may cause some difficulty for the reader; punctuation may be faulty.

Band 5 — TA: generally addresses task requirements but may be mechanical/list-like; key features/bullet points not always fully covered; recounting may lack data support; tone/purpose can be unclear or inconsistent. CC: tendency to focus on details without an overall picture; organisation not always clear; limited/possibly inaccurate use of cohesive devices and reference. LR: limited range, repetitive vocabulary; noticeable errors in spelling/word formation causing some strain for the reader. GRA: only a limited range of structures attempted; frequent grammatical errors that may sometimes impede understanding.

Band 4 — TA: response is an attempt at the task but key features/bullet points are minimal, missing, or wrongly selected; little/no overview; tone or format often inappropriate. CC: little logical organisation; relationship between ideas unclear or inadequately marked; minimal/mechanical use of cohesive devices; little/no paragraphing. LR: limited and inadequate vocabulary for the task; noticeable, possibly disruptive spelling/word-formation errors. GRA: very limited range of structures with rare correct complex attempts; frequent errors that may severely distort meaning.

Band 3 — TA: does not adequately address the requirements; format may be inappropriate; key features/bullet points largely missing or only briefly mentioned, repetitive. CC: little or no organisation of information; no clear progression; minimal control of cohesive devices. LR: extremely limited vocabulary, largely memorised or repeated phrases; very weak control of word formation/spelling. GRA: little control of grammatical forms except in memorised phrases; errors predominate and severely impede meaning.

Band 2 — TA: content barely relates to the task. CC: little relevant message; minimal organisational control. LR: extremely limited vocabulary, virtually no evidence of control. GRA: little or no evidence of sentence forms, except in memorised phrases.

Band 1 — Response of 20 words or fewer, OR content wholly unrelated to the task, OR an entirely memorised/copied script unconnected to the question.

Band 0 — Did not attend/attempt the question in any way; used a language other than English throughout; OR there is clear proof the answer is entirely memorised and disconnected from the task. (Applies in this app whenever the text is random characters/keyboard mashing with no rateable English language.)`;

    const T2_BANDS = `
OFFICIAL TASK 2 BAND DESCRIPTORS (use these to anchor every score):

Band 9 — TR: fully and appropriately addresses all parts of the task; a fully developed position is given with extremely well-supported, relevant, fully extended ideas. CC: message follows effortlessly; cohesion barely noticeable; paragraphing skilful. LR: full flexibility and precise, natural vocabulary; minor spelling/word-formation slips are extremely rare. GRA: wide range of structures used with full flexibility and control; virtually error-free.

Band 8 — TR: sufficiently addresses all parts; a well-developed response with relevant, extended and well-supported ideas. CC: logically sequenced, well-managed cohesion, occasional minor lapses, good paragraphing. LR: wide resource used fluently and flexibly; skilful use of less common/idiomatic items; occasional inaccuracies that barely affect meaning. GRA: wide range of structures, majority of sentences error-free, only occasional non-systematic errors.

Band 7 — TR: addresses all parts of the prompt, though some parts may be more fully covered than others; a clear overall position is presented throughout; main ideas are extended and supported but there can be a tendency to over-generalise or lack focus in supporting ideas. CC: logically organised with clear progression; cohesive devices used flexibly with some inaccuracy or over/under-use. LR: sufficient range for some flexibility and precision; some less common/idiomatic items used; only a few spelling/word-formation errors. GRA: mix of simple and complex sentences; complex ones less accurate than simple ones; errors occur but rarely impede communication.

Band 6 — TR: addresses all parts of the prompt although some parts may be more fully covered than others; a relevant position is presented though conclusions may become unclear or repetitive; relevant main ideas are presented but some may be underdeveloped or unclear. CC: organisation evident but not wholly logical; ideas followable but not always fluently linked; cohesive devices sometimes inaccurate, limited or overused. LR: generally adequate vocabulary; meaning clear despite restricted range or imprecision; some spelling/word-formation errors that don't impede communication. GRA: limited and somewhat repetitive range; complex sentences attempted but often faulty; frequent errors may cause some difficulty for the reader.

Band 5 — TR: addresses the task only partially; the format may be inappropriate in places; the position is unclear or repetitive; main ideas are presented but limited and not well developed, and there may be irrelevant detail. CC: tendency to focus on details without an overall picture; organisation not always clear; limited/possibly inaccurate cohesive devices. LR: limited range, repetitive vocabulary; noticeable errors in spelling/word formation causing some strain for the reader. GRA: only a limited range of structures attempted; frequent grammatical errors that may sometimes impede understanding.

Band 4 — TR: responds to the task only minimally, or the task is misunderstood in part; position is unclear; few ideas, which are largely undeveloped or irrelevant. CC: little logical organisation; relationship between ideas unclear or inadequately marked; minimal/mechanical use of cohesive devices; little/no paragraphing. LR: limited and inadequate vocabulary for the task; noticeable, possibly disruptive spelling/word-formation errors. GRA: very limited range of structures with rare correct complex attempts; frequent errors that may severely distort meaning.

Band 3 — TR: does not adequately address any part of the task; no clear position is given; little or no evidence of ideas relevant to the task. CC: little or no organisation of information; no clear progression; minimal control of cohesive devices. LR: extremely limited vocabulary, largely memorised or repeated phrases; very weak control of word formation/spelling. GRA: little control of grammatical forms except in memorised phrases; errors predominate and severely impede meaning.

Band 2 — TR: barely responds to the task; almost no relevant content. CC: little relevant message; minimal organisational control. LR: extremely limited vocabulary, virtually no evidence of control. GRA: little or no evidence of sentence forms, except in memorised phrases.

Band 1 — Response of 20 words or fewer, OR content wholly unrelated to the task, OR an entirely memorised/copied script unconnected to the question.

Band 0 — Did not attend/attempt the question in any way; used a language other than English throughout; OR there is clear proof the answer is entirely memorised and disconnected from the task. (Applies in this app whenever the text is random characters/keyboard mashing with no rateable English language.)`;

    // Serialise built-in chart data into a readable table so Gemini can fact-check exact figures
    function buildChartDataText(cd) {
      if (!cd) return "";
      if (cd.type === "doughnut") {
        const rows = cd.labels.map((l, i) => `${l}: ${cd.values[i]}%`).join("\n");
        return `\nEXACT CHART DATA (the candidate must accurately reflect these real figures):\nTitle: ${cd.title}\nType: pie/doughnut chart\n${rows}\n`;
      }
      const header = "Category".padEnd(10) + " | " + cd.series.map(s => s.name).join(" | ");
      const rows = cd.labels.map((lab, i) =>
        String(lab).padEnd(10) + " | " + cd.series.map(s => s.values[i]).join(" | ")
      ).join("\n");
      return `\nEXACT CHART DATA (the candidate must accurately reflect these real figures, not invented ones):\nTitle: ${cd.title}\nType: ${cd.type} chart — X axis: ${cd.xLabel} — Y axis: ${cd.yLabel}\n${header}\n${rows}\n`;
    }
    const chartDataText = buildChartDataText(chartData);

    const factCheckInstruction = `
FACTUAL ACCURACY CHECK (Task 1 only, mandatory when chart data is available below or in the attached image):
Compare EVERY number, comparison, trend, and ranking the candidate states against the actual chart data. Check each one individually. List every factual inaccuracy you find — wrong figures, invented numbers, wrong direction of trend, wrong ranking/comparison, or a claimed "highest/lowest/largest" that is not actually correct — in the "fact_errors" array, each entry written as one sentence: what the candidate claimed, and what the chart actually shows. If there are no factual errors, return an empty array []. Many automated scorers ignore numeric accuracy — you must NOT do that: accuracy of chart data is more important than vocabulary sophistication, and Task Achievement MUST be reduced (sometimes substantially) when the candidate's figures or comparisons don't match the real data.`;

    const scoringRules = `
${taskNumber === 1 ? T1_BANDS : T2_BANDS}

CRITICAL RULE — apply Band 0 ONLY in these exact cases, never for merely weak writing:
- Random characters / keyboard mashing (e.g. "afaf aevvv kjkj")
- Totally unrelated to the task topic
- Essentially blank or far too short to assess (a handful of words)
- No coherent English sentences at all
In these cases set ta_score, cc_score, lr_score, gra_score and overall ALL to 0, and ta_feedback/summary must plainly state this is not a valid, ratable attempt. strengths must be exactly ["None — no valid attempt was made"].

For ANY genuine attempt — even if very weak, short, or full of errors — do NOT default to Band 0 or inflate to Band 4. Read the actual text closely and match it against the specific wording of each band level above for EACH of the four criteria independently; a candidate's four scores often differ from one another (e.g. TA could be 5 while GRA is 6.5) — do not force them to match.

DEEP ANALYSIS REQUIRED — do not give generic feedback. For each of the four criteria, your feedback MUST reference specific evidence from THIS candidate's actual text: quote or closely paraphrase 1-2 actual phrases/sentences they wrote, name the actual grammatical structures or vocabulary they used (or failed to use), and identify concrete, recurring error patterns (e.g. article omission, subject-verb agreement, run-on sentences, informal register, repeated linking words) rather than vague statements like "some errors occur."
${taskNumber === 1 ? factCheckInstruction : '\nfact_errors must be an empty array [] for Task 2 (there is no chart data to fact-check).'}

SCORING SCALE: half-bands only — 0, 1, 2, 3, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9.
WORD COUNT: ${wordCount} / minimum ${minWords}${belowMin ? " — WARNING: BELOW MINIMUM, penalise Task " + (taskNumber === 1 ? "Achievement" : "Response") + " for this" : ""}.
overall = arithmetic mean of the four criteria scores, rounded to the nearest 0.5. Be a strict, honest examiner — do NOT inflate scores out of politeness. Write all feedback in clear, simple English a B1-level learner can understand.`;

    let parts;
    let promptText;

    if (taskImage) {
      const base64 = taskImage.includes(",") ? taskImage.split(",")[1] : taskImage;
      const mime = taskImageType || "image/jpeg";

      promptText = `You are a senior, strict IELTS examiner with 20 years of experience marking real exam scripts.

The attached image is an IELTS Writing Task 1 question from a real exam (chart, graph, diagram, table, process, or map).

CANDIDATE: ${userName}
RESPONSE (${wordCount} words):
${userResponse}

First, carefully analyse exactly what the image shows (every series, every key figure, trends, comparisons). Then check whether the candidate's response accurately and completely reflects what is actually in the image — penalise Task Achievement if they describe data that is not present or miss major features that are present. Then score the response against the official band descriptors below.

${scoringRules}

ta_label field must be exactly "Task Achievement".`;

      parts = [
        { text: promptText },
        { inline_data: { mime_type: mime, data: base64 } }
      ];
    } else {
      promptText = `You are a senior, strict IELTS examiner with 20 years of experience marking real exam scripts. Score this IELTS Writing Task ${taskNumber} response.

CANDIDATE: ${userName}
TASK QUESTION: ${taskQuestion}
${chartDataText}
RESPONSE (${wordCount} words):
${userResponse}

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
            temperature: 0.3,
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
      scoreData = await callGemini();
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: scoreData }) };

  } catch (err) {
    console.error("Evaluate error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
