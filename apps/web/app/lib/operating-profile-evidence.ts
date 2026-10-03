export type OperatingProfileSourceAnswer = {
  question: string;
  answer: string;
};

export type OperatingProfileSourceSubmission = {
  id: string;
  respondentName: string;
  sourceTitle: string;
  answers: OperatingProfileSourceAnswer[];
};

export const lewisLeadershipAlignmentSubmission = {
  id: "fg-exterior-care-leadership-alignment-lewis",
  respondentName: "Lewis",
  sourceTitle: "FG Exterior Care Leadership Alignment",
  answers: [
    {
      question: "What do you ultimately want from building a business?",
      answer: "Security; I want something that will sustain myself and my family and my family for generations to come.",
    },
    {
      question: "Where do you genuinely want to be in 5–10 years?",
      answer: "I want to be in a position where I have full clarity and understanding of how every aspect of my life beyond this is going to play out. Becoming self employed will grant me access to that where as staying in the corporate system will restrict me.",
    },
    {
      question: "What level of time and commitment are you realistically prepared to give over the next 1–3 years?",
      answer: "At the very beginning it will be a gradual integration which will then unfold into full time work over an accelerated period of time. Once fully immersed within my role I will be doing all the work that is necessary to feed the business.",
    },
    {
      question: "What does \"sacrifice\" mean to you when building something ambitious, and what sacrifices are you willing or unwilling to make?",
      answer: "“Losing” in the present to win much greater in the future is the obvious sacrifice to make.",
    },
    {
      question: "What does a high standard of work mean to you?",
      answer: "Working until there is almost no room for improvement.",
    },
    {
      question: "How should we handle disagreement and conflict between us?",
      answer: "In a civilised, respectful and productive manner.",
    },
    {
      question: "What do you believe you are strongest at, and where could you create the most value?",
      answer: "My customer service abilities (B2B & B2C) are next to none and have been perfected over the last 10 years In multiple different fields and professions.\nMy attention to detail is razor sharp and when I find some thing that keeps my attention, challenges my brain in more ways than one and puts good cash in my pocket will receive 100% focus and determination.",
    },
    {
      question: "What are your biggest weaknesses or development areas?",
      answer: "Being confident within my abilities especially around new skills.",
    },
    {
      question: "How do you normally behave under pressure or when something goes wrong?",
      answer: "Immediately establish the worst possible outcome, eliminate that threat and then work backwards until there is no longer a threat/hurdle and work out the best plausible solution.",
    },
    {
      question: "What do you expect financially from your involvement if the business grows?",
      answer: "Whatever I am in receipt of.",
    },
    {
      question: "What behaviour from another person would make you no longer want to build a business with them?",
      answer: "Irrational behaviour, ignorance to mistakes previously made, reluctance to listen/learn/grow.\nIcarus type behaviour.",
    },
    {
      question: "What would need to be true for you to make a deeper long-term commitment to this business and team?",
      answer: "Motion, growth and scalability.",
    },
  ],
} satisfies OperatingProfileSourceSubmission;

export function normaliseOperatingProfileSourceSubmissions(
  value: unknown,
): OperatingProfileSourceSubmission[] {
  if (!Array.isArray(value)) return [];

  const submissions: OperatingProfileSourceSubmission[] = [];
  value.forEach((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const source = entry as Record<string, unknown>;
    if (
      typeof source.id !== "string"
      || typeof source.respondentName !== "string"
      || typeof source.sourceTitle !== "string"
      || !Array.isArray(source.answers)
    ) return;

    const answers: OperatingProfileSourceAnswer[] = [];
    source.answers.forEach((answer: unknown) => {
      if (!answer || typeof answer !== "object" || Array.isArray(answer)) return;
      const answerRecord = answer as Record<string, unknown>;
      if (typeof answerRecord.question !== "string" || typeof answerRecord.answer !== "string") return;
      answers.push({ question: answerRecord.question, answer: answerRecord.answer });
    });

    submissions.push({
      id: source.id,
      respondentName: source.respondentName,
      sourceTitle: source.sourceTitle,
      answers,
    });
  });

  return submissions;
}

export function mergeOperatingProfileSourceSubmissions(
  existing: unknown,
  incoming: readonly OperatingProfileSourceSubmission[],
): OperatingProfileSourceSubmission[] {
  const merged = normaliseOperatingProfileSourceSubmissions(existing);

  incoming.forEach((submission) => {
    const index = merged.findIndex((entry) => entry.id === submission.id);
    const copy: OperatingProfileSourceSubmission = {
      ...submission,
      answers: submission.answers.map((answer) => ({ ...answer })),
    };
    if (index === -1) {
      merged.push(copy);
    } else {
      merged[index] = copy;
    }
  });

  return merged;
}

export type SourceSubmissionAttachmentResult<T> = {
  people: T[];
  status: "attached" | "person-not-found" | "ambiguous-person";
};

export function attachOperatingProfileSourceSubmission<T>(
  people: readonly T[],
  submission: OperatingProfileSourceSubmission,
  getName: (person: T) => string,
  getSourceSubmissions: (person: T) => unknown,
  withSourceSubmissions: (person: T, submissions: OperatingProfileSourceSubmission[]) => T,
): SourceSubmissionAttachmentResult<T> {
  const matchingPeople = people.filter(
    (person) => getName(person).trim().toLowerCase() === submission.respondentName.trim().toLowerCase(),
  );

  if (matchingPeople.length === 0) return { people: [...people], status: "person-not-found" };
  if (matchingPeople.length > 1) return { people: [...people], status: "ambiguous-person" };

  const target = matchingPeople[0];
  return {
    people: people.map((person) => person === target
      ? withSourceSubmissions(
        person,
        mergeOperatingProfileSourceSubmissions(getSourceSubmissions(person), [submission]),
      )
      : person),
    status: "attached",
  };
}
