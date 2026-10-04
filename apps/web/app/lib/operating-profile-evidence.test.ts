import { describe, expect, it } from "vitest";
import { persistJsonArray } from "./persistence";
import {
  attachOperatingProfileSourceSubmission,
  emekaLeadershipAlignmentSubmission,
  lewisLeadershipAlignmentSubmission,
  mergeOperatingProfileSourceSubmissions,
  normaliseOperatingProfileSourceSubmissions,
  type OperatingProfileSourceSubmission,
} from "./operating-profile-evidence";

type TestPerson = {
  id: string;
  name: string;
  responsibilities: string;
  authority: string;
  operatingProfile?: {
    sourceSubmissions?: OperatingProfileSourceSubmission[];
    communicationStyle?: { value: string; evidence: string };
  };
};

function attach(
  people: readonly TestPerson[],
  submission: OperatingProfileSourceSubmission,
) {
  return attachOperatingProfileSourceSubmission(
    people,
    submission,
    (person) => person.name,
    (person) => person.operatingProfile?.sourceSubmissions,
    (person, sourceSubmissions) => ({
      ...person,
      operatingProfile: {
        ...person.operatingProfile,
        sourceSubmissions,
      },
    }),
  );
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  };
}

describe("operating profile source evidence", () => {
  it("stores Lewis's twelve submitted question and answer pairs verbatim and in order", () => {
    expect(lewisLeadershipAlignmentSubmission.answers).toHaveLength(12);
    expect(lewisLeadershipAlignmentSubmission.answers).toEqual([
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
    ]);
  });

  it("stores Emeka's twelve submitted question and answer pairs verbatim and in order", () => {
    expect(emekaLeadershipAlignmentSubmission).toMatchObject({
      id: "fg-exterior-care-leadership-alignment-emeka",
      respondentName: "Emeka",
      sourceTitle: "FG Exterior Care Leadership Alignment",
    });
    expect(emekaLeadershipAlignmentSubmission.answers).toEqual([
      {
        question: "What do you ultimately want from building a business?",
        answer: "I ultimately want to build a business that gives me financial freedom without sacrificing my time or quality of life.I want the freedom to choose how I spend my time and create opportunities for myself and the people around me.I want to build something meaningful and scalable that I can be genuinely proud of.I also want the challenge of becoming a better leader, making a real impact, and taking responsibility for something I’ve created.Ultimately, I want the business to give me a sense of achievement, independence, and long-term purpose.",
      },
      {
        question: "Where do you genuinely want to be in 5–10 years?",
        answer: "I want to be part of a successful, established business that has grown significantly and operates with strong systems, a clear reputation and a reliable team. I want to have meaningful responsibility within the business, helping make important decisions and contributing to its long-term direction rather than simply carrying out tasks. Personally, I want financial independence, flexibility over my time and the ability to enjoy life while still being proud of what I have helped build. I would like the business to be large enough to create opportunities for other people while remaining well-run, ambitious and financially sustainable.",
      },
      {
        question: "What level of time and commitment are you realistically prepared to give over the next 1–3 years?",
        answer: "I am prepared to put serious time and energy into the business, particularly during the early stages when momentum and foundations are being built. Ideally, I would like to give as much time as necessary to make the business successful, but realistically I need to balance this with my existing responsibilities and make sure my commitment is sustainable. I am willing to work evenings, weekends and outside normal hours when there is a genuine need, especially around important deadlines or opportunities. My expectation is that commitment should be consistent and reliable rather than based on short bursts of motivation.",
      },
      {
        question: "What does \"sacrifice\" mean to you when building something ambitious, and what sacrifices are you willing or unwilling to make?",
        answer: "To me, sacrifice means being willing to give up some short-term comfort, free time and immediate financial reward in order to build something that has greater long-term value. I am willing to sacrifice some weekends, social time and convenience when the business genuinely requires it, and I am willing to invest heavily in learning and developing my skills. I am also comfortable with delayed financial reward if there is a clear long-term opportunity and everyone is contributing fairly. What I am unwilling to sacrifice is my integrity, important relationships, my long-term health or a sustainable balance that allows me to continue performing at a high level.",
      },
      {
        question: "What does a high standard of work mean to you?",
        answer: "A high standard means doing work properly rather than simply doing enough to get it finished. I expect myself to be reliable, prepared, detail-focused and accountable for the quality of what I produce, particularly when my name is attached to it. If I make a mistake, I believe it is important to acknowledge it quickly, fix it and learn from it rather than hide it or blame someone else. I also think high standards mean being professional with customers, teammates and partners and consistently looking for ways to improve how we operate.",
      },
      {
        question: "How should we handle disagreement and conflict between us?",
        answer: "Disagreements should be handled directly, respectfully and based on facts rather than personalities or emotion. Everyone should be able to challenge an idea or decision without it becoming personal, and we should listen properly before deciding where we stand. If we cannot agree, we should look at the evidence, consider the impact on the business and establish who has responsibility for the particular decision. Once a decision has been made, I think everyone should support it unless there is a serious ethical, legal or business-critical reason to raise the issue again.",
      },
      {
        question: "What do you believe you are strongest at, and where could you create the most value?",
        answer: "I believe one of my strengths is being dependable and willing to take responsibility rather than waiting for someone else to solve a problem. I can add value through organisation, communication, problem-solving and staying focused on what actually needs to be done. I also think I can contribute by looking at situations practically, identifying opportunities and helping turn ideas into actions rather than leaving them as discussions. As the business develops, I would like to take on more responsibility around operations, commercial decisions and helping build efficient systems.",
      },
      {
        question: "What are your biggest weaknesses or development areas?",
        answer: "One area I want to improve is becoming more confident and decisive when making important decisions, particularly when there is uncertainty or incomplete information. I also want to continue developing my commercial knowledge, leadership ability and understanding of the financial side of running a business. At times I can spend too long thinking through different possibilities, so I want to become better at making informed decisions quickly and then adjusting when new information becomes available. I would value honest feedback from the team, clear expectations and people who are willing to challenge me constructively.",
      },
      {
        question: "How do you normally behave under pressure or when something goes wrong?",
        answer: "When things go wrong, I generally try to stay calm and focus on what can actually be controlled rather than reacting emotionally. I prefer to understand the problem, identify the immediate priorities and work towards a practical solution. The other two should know that I may become more focused and direct under pressure, but that is normally because I am trying to solve the issue rather than avoid it. I would expect us to communicate honestly during difficult situations and make sure problems are raised early rather than allowing them to become bigger.",
      },
      {
        question: "What do you expect financially from your involvement if the business grows?",
        answer: "I expect financial reward to reflect the value each person contributes, the level of responsibility they take on and the amount of risk and commitment they have invested. I am not expecting everything to be immediately financially rewarding, particularly in the early stages, because I understand that building a strong business may require reinvestment and delayed returns. Over time, I would expect there to be a fair structure for salaries, profits and/or ownership that is transparent and agreed between everyone. For me, fairness and clarity are more important than simply maximising short-term income.",
      },
      {
        question: "What behaviour from another person would make you no longer want to build a business with them?",
        answer: "A serious lack of honesty or trust would be a major breaking point for me, particularly around money, customers, commitments or important business information. I would also struggle to work with someone who repeatedly fails to deliver, avoids responsibility, refuses to communicate or consistently produces work below the agreed standard. Disrespect, manipulation, unnecessary ego and making decisions based purely on personal interests rather than what is best for the business would also be unacceptable. I can accept mistakes, disagreements and different opinions, but I would expect honesty, accountability, respect and a genuine commitment to the team.",
      },
      {
        question: "What would need to be true for you to make a deeper long-term commitment to this business and team?",
        answer: "I would need to see that the business has a genuine opportunity to become successful and that the three of us are aligned on where we want to take it. I would want clear roles, responsibilities and expectations so that everyone understands what they are accountable for and how decisions are made. Trust would also be important: I would need to see consistency, transparency and evidence that everyone is prepared to contribute rather than relying on one or two people to carry the business. If the business is showing genuine progress, the team works well together and there is a fair structure around ownership, responsibility and financial reward, I would be comfortable making a much deeper long-term commitment.",
      },
    ]);
  });

  it("normalises missing evidence to the empty state and keeps legacy People records valid", () => {
    expect(normaliseOperatingProfileSourceSubmissions(undefined)).toEqual([]);
    const legacyPerson: TestPerson = {
      id: "person-legacy",
      name: "Calum",
      responsibilities: "Existing responsibilities",
      authority: "Existing authority",
    };
    expect(attach([legacyPerson], lewisLeadershipAlignmentSubmission)).toEqual({
      people: [legacyPerson],
      status: "person-not-found",
    });
    expect(legacyPerson.operatingProfile).toBeUndefined();
  });

  it("adds submitted evidence to a legacy Lewis record without rewriting its formal fields", () => {
    const legacyLewis: TestPerson = {
      id: "person-lewis",
      name: "Lewis",
      responsibilities: "Existing responsibility text",
      authority: "Existing authority text",
    };

    const result = attach([legacyLewis], lewisLeadershipAlignmentSubmission);

    expect(result.status).toBe("attached");
    expect(result.people[0]).toMatchObject({
      id: "person-lewis",
      responsibilities: "Existing responsibility text",
      authority: "Existing authority text",
      operatingProfile: { sourceSubmissions: [lewisLeadershipAlignmentSubmission] },
    });
  });

  it("attaches Emeka's evidence to the matching People record without changing formal fields", () => {
    const emeka: TestPerson = {
      id: "person-emeka",
      name: " Emeka ",
      responsibilities: "Existing Emeka responsibilities",
      authority: "Existing Emeka authority",
      operatingProfile: {
        communicationStyle: { value: "Existing observation", evidence: "Existing evidence" },
      },
    };
    const otherPerson: TestPerson = {
      id: "person-other",
      name: "Lewis",
      responsibilities: "Unchanged",
      authority: "Unchanged",
    };

    const result = attach([emeka, otherPerson], emekaLeadershipAlignmentSubmission);

    expect(result.status).toBe("attached");
    expect(result.people[0]).toMatchObject({
      id: "person-emeka",
      responsibilities: "Existing Emeka responsibilities",
      authority: "Existing Emeka authority",
      operatingProfile: {
        communicationStyle: { value: "Existing observation", evidence: "Existing evidence" },
        sourceSubmissions: [emekaLeadershipAlignmentSubmission],
      },
    });
    expect(result.people[1]).toBe(otherPerson);
  });

  it("adds Emeka's evidence to a legacy People record without requiring an existing profile", () => {
    const legacyEmeka: TestPerson = {
      id: "person-emeka",
      name: "Emeka",
      responsibilities: "Existing responsibility text",
      authority: "Existing authority text",
    };

    const result = attach([legacyEmeka], emekaLeadershipAlignmentSubmission);

    expect(result.status).toBe("attached");
    expect(result.people[0]).toMatchObject({
      id: "person-emeka",
      responsibilities: "Existing responsibility text",
      authority: "Existing authority text",
      operatingProfile: { sourceSubmissions: [emekaLeadershipAlignmentSubmission] },
    });
  });

  it("attaches the submission to Lewis without changing formal facts or structured observations", () => {
    const lewis: TestPerson = {
      id: "person-lewis",
      name: " Lewis ",
      responsibilities: "Existing responsibilities",
      authority: "Existing authority",
      operatingProfile: {
        communicationStyle: { value: "", evidence: "" },
      },
    };

    const result = attach([lewis], lewisLeadershipAlignmentSubmission);

    expect(result.status).toBe("attached");
    expect(result.people[0]).toMatchObject({
      id: lewis.id,
      responsibilities: lewis.responsibilities,
      authority: lewis.authority,
      operatingProfile: {
        communicationStyle: { value: "", evidence: "" },
        sourceSubmissions: [lewisLeadershipAlignmentSubmission],
      },
    });
  });

  it("persists and rehydrates the evidence through the People array without loss", () => {
    const storage = memoryStorage();
    const people: TestPerson[] = [{
      id: "person-lewis",
      name: "Lewis",
      responsibilities: "Unchanged",
      authority: "Unchanged",
    }];
    const attached = attach(people, lewisLeadershipAlignmentSubmission);
    persistJsonArray(storage, "people", attached.people);

    const storedPeople = JSON.parse(storage.getItem("people") || "[]") as TestPerson[];
    const rehydrated = attach(storedPeople, lewisLeadershipAlignmentSubmission);

    expect(rehydrated.status).toBe("attached");
    expect(rehydrated.people[0].operatingProfile?.sourceSubmissions).toEqual([
      lewisLeadershipAlignmentSubmission,
    ]);
    expect(rehydrated.people[0].responsibilities).toBe("Unchanged");
    expect(rehydrated.people[0].authority).toBe("Unchanged");
  });

  it("persists and rehydrates Emeka's evidence without duplicating it", () => {
    const storage = memoryStorage();
    const people: TestPerson[] = [{
      id: "person-emeka",
      name: "Emeka",
      responsibilities: "Unchanged",
      authority: "Unchanged",
    }];
    const attached = attach(people, emekaLeadershipAlignmentSubmission);
    persistJsonArray(storage, "people", attached.people);

    const storedPeople = JSON.parse(storage.getItem("people") || "[]") as TestPerson[];
    const rehydrated = attach(storedPeople, emekaLeadershipAlignmentSubmission);

    expect(rehydrated.status).toBe("attached");
    expect(rehydrated.people[0].operatingProfile?.sourceSubmissions).toEqual([
      emekaLeadershipAlignmentSubmission,
    ]);
    expect(rehydrated.people[0].responsibilities).toBe("Unchanged");
    expect(rehydrated.people[0].authority).toBe("Unchanged");
  });

  it("replaces a repeated submission deterministically without duplicating it", () => {
    const once = mergeOperatingProfileSourceSubmissions([], [lewisLeadershipAlignmentSubmission]);
    const twice = mergeOperatingProfileSourceSubmissions(once, [lewisLeadershipAlignmentSubmission]);

    expect(twice).toEqual(once);
    expect(twice).toHaveLength(1);
  });

  it("does not mutate existing profile data or the submitted source object", () => {
    const originalSubmission = structuredClone(lewisLeadershipAlignmentSubmission);
    const originalPerson: TestPerson = {
      id: "person-lewis",
      name: "Lewis",
      responsibilities: "Unchanged",
      authority: "Unchanged",
      operatingProfile: {
        sourceSubmissions: [],
        communicationStyle: { value: "Existing observation", evidence: "Existing evidence" },
      },
    };
    const originalPersonSnapshot = structuredClone(originalPerson);

    attach([originalPerson], lewisLeadershipAlignmentSubmission);

    expect(lewisLeadershipAlignmentSubmission).toEqual(originalSubmission);
    expect(originalPerson).toEqual(originalPersonSnapshot);
  });

  it("supports the same evidence structure for another person without Lewis-specific fields", () => {
    const anotherSubmission: OperatingProfileSourceSubmission = {
      id: "fg-exterior-care-leadership-alignment-calum",
      respondentName: "Calum",
      sourceTitle: "FG Exterior Care Leadership Alignment",
      answers: [{ question: "What matters to you?", answer: "A source-backed response." }],
    };
    const calum: TestPerson = {
      id: "person-calum",
      name: "Calum",
      responsibilities: "",
      authority: "",
    };

    const result = attach([calum], anotherSubmission);

    expect(result.status).toBe("attached");
    expect(result.people[0].operatingProfile?.sourceSubmissions).toEqual([anotherSubmission]);
  });

  it("does not attach source answers when the respondent name is ambiguous", () => {
    const people: TestPerson[] = [
      { id: "person-one", name: "Lewis", responsibilities: "", authority: "" },
      { id: "person-two", name: "Lewis", responsibilities: "", authority: "" },
    ];

    const result = attach(people, lewisLeadershipAlignmentSubmission);

    expect(result.status).toBe("ambiguous-person");
    expect(result.people).toEqual(people);
  });

  it("reports missing and ambiguous Emeka matches using the shared attachment behavior", () => {
    const missing = attach(
      [{ id: "person-lewis", name: "Lewis", responsibilities: "", authority: "" }],
      emekaLeadershipAlignmentSubmission,
    );
    const ambiguousPeople: TestPerson[] = [
      { id: "person-one", name: "Emeka", responsibilities: "", authority: "" },
      { id: "person-two", name: " emeka ", responsibilities: "", authority: "" },
    ];
    const ambiguous = attach(ambiguousPeople, emekaLeadershipAlignmentSubmission);

    expect(missing).toEqual({
      people: [{ id: "person-lewis", name: "Lewis", responsibilities: "", authority: "" }],
      status: "person-not-found",
    });
    expect(ambiguous.status).toBe("ambiguous-person");
    expect(ambiguous.people).toEqual(ambiguousPeople);
  });
});
