import { describe, expect, it } from "vitest";
import { persistJsonArray } from "./persistence";
import {
  attachOperatingProfileSourceSubmission,
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
});
