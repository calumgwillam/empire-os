import { describe, expect, it } from "vitest";
import { persistJsonArray } from "./persistence";
import {
  attachIndividualOperatingUnderstandings,
  founderIndividualOperatingUnderstandings,
  individualOperatingDimensions,
  mergeIndividualOperatingUnderstandings,
  normaliseIndividualOperatingUnderstandings,
  type IndividualOperatingUnderstanding,
} from "./individual-operating-understanding";
import {
  attachOperatingProfileSourceSubmission,
  calumLeadershipReflectionSubmission,
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
    individualUnderstandings?: IndividualOperatingUnderstanding[];
    communicationStyle?: { value: string; evidence: string; sourceSubmissionIds?: string[] };
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
    expect(lewisLeadershipAlignmentSubmission).toMatchObject({
      id: "fg-exterior-care-leadership-alignment-lewis",
      respondentName: "Lewis",
      sourceTitle: "FG Exterior Care Leadership Alignment",
    });
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

  it("stores Calum's twelve source pairs verbatim and in order with document provenance", () => {
    expect(calumLeadershipReflectionSubmission).toMatchObject({
      id: "fg-exterior-care-leadership-alignment-calum-2026-09-27",
      respondentName: "Calum",
      sourceTitle: "FG Exterior Care Leadership Alignment",
      sourceReference: "FG_Exterior_Care_Calum_Leadership_Reflection_27_Sep_2026.docx — Questions for the Three of Us — Calum's Answers; answers were \"tightened for clarity, but not softened\".",
    });
    expect(calumLeadershipReflectionSubmission.answers).toEqual([
      {
        question: "What do you ultimately want from building a business?",
        answer: "I want a life with real purpose. I am genuinely willing to make an extreme commitment of time, effort and sacrifice to create a reality that is fundamentally different from the one I am living now. I will work relentlessly until that change happens. Leisure and surface-level conversation do not motivate me in the same way; I want to build something genuinely special, and I understand that doing so will require tremendous sacrifice.\n\nThat desired lifestyle comes with a very high level of responsibility. I accept that the demands will be difficult and sustained because that responsibility is part of the price of creating the life and organisation I want.\n\nI want the scale to be monumental. I want to build an empire — something of note, something with real merit, and something that stands as evidence of what can be built through disciplined execution. The organisation should be deeply systems-based. Reaching that scale cannot depend on one person simply working harder forever. The scale itself should reflect that a very high level of both intelligent work and hard work has been applied across strategy, operations, people, systems, finance, leadership, execution and expansion.\n\nI do not see achievement as one single end point. Over a long enough period, consistency combined with the right work will compound toward the long-term goals and eventual end state. Progress exists on a sliding scale: different milestones, improvements and breakthroughs will increase the likelihood of reaching that larger outcome. There is no such thing as progress that is too small to matter if it becomes another cog in the wider system. That means there will be many moments where achievement can be recognised and appreciated without losing sight of the larger ambition.\n\nWhen I think about freedom, the most important angle for me is creating both time incentives and financial incentives through smart work and hard work. I do not see freedom as simply having more money or having less responsibility. I see it as building enough leverage that money, people and systems begin working together in our favour.\n\nTime is finite, but the way an organisation is built can radically change how much effective capacity exists within that time. Money can buy back time. The right people can multiply what can be achieved without everything depending on one individual. Strong systems can remove repetition, reduce unnecessary decision-making and allow work to continue without constant founder involvement.\n\nWhen these things compound together, we effectively begin to bend the practical reality of time. We are no longer limited to what one person can personally accomplish hour by hour. The organisation creates additional capacity around us.\n\nThis is one of the main reasons I am so focused on making Empire OS increasingly autonomous. I am constantly trying to build it in a way that reduces dependence on my memory, attention and manual involvement because I place an extremely high value on freedom. The more Empire OS can preserve information, surface priorities, direct execution, support delegation, reduce founder dependency and maintain continuity without me manually holding everything together, the more time and cognitive capacity it gives back.\n\nThat is the freedom I want to build: enough financial strength, capable people and reliable systems that the Empire can continue operating and progressing without consuming every available hour of our lives. This creates the ability to pursue other meaningful goals, experiences and side quests without sacrificing or weakening the core organisation.\n\nMoney matters because it creates options. Time matters because it is ultimately irreplaceable. My goal is to use smart work, hard work, capital, people and systems together to create increasing control over both — and therefore increasing control over how we are able to live our lives.\n\nStatus matters to me, but mainly as a by-product of building something genuinely impressive rather than chasing attention for its own sake. I want to earn respect through the scale, quality, discipline and endurance of what I build. Recognition from people whose judgement I respect would matter, but proving to myself that I was capable of building something exceptional matters more.\n\nFor impact, I want to focus less on what the business gives me personally and more on how it affects the people connected to it. For workers, I want them to feel that their work has purpose and that they are financially comfortable. I do not want people to feel unnecessarily constrained financially or held back in their development. If someone genuinely earns greater responsibility, progression or reward, I do not want the organisation to become the thing that bottlenecks or stunts that growth.\n\nFor clients, I want every interaction to reinforce the view that we are serious operators. That means professionalism, reliability, quality, communication, consistency, organisation, presentation and delivery all working together. No single part is enough on its own; the whole experience has to create confidence that they are dealing with a capable and well-run company.",
      },
      {
        question: "Where do you genuinely want to be in 5–10 years?",
        answer: "In five years, I will not be doing practical work myself. I want to be operating from the top down, orchestrating the infrastructure rather than being trapped inside day-to-day delivery.\n\nThe practical work being carried out beneath me should definitely include garden maintenance and hard landscape construction, with excavation ideally becoming another pillar depending on whether the right commercial and operational conditions are proven.\n\nMy responsibility level will remain that of a co-owner, but what that actually means day to day is far more nuanced. My responsibilities should increasingly centre on orchestration, strategic direction, systems, people, capital allocation, decision-making and ensuring that the organisation is moving in the right direction.\n\nThe first 5–10 years are about establishing a very substantial footing for something much larger. That means continuing to expand my own capabilities, continuing to develop Empire OS, and deliberately building the systems and organisational structure required for scale.\n\nThere also needs to be a sophisticated transition from practical work into orchestration. I do not expect that transition to happen overnight. Like most things, it will exist on a sliding scale. In the early stages, practical execution will heavily outweigh orchestration, but the percentage of my time spent orchestrating should increase progressively as systems, people and operational capacity become stronger.\n\nBusiness scale is difficult to define precisely at this stage. As Emeka said in the initial meeting, time will tell, and I think that is an important point. Scale should be driven by evidence, capability and what the organisation proves it can sustain rather than by forcing an arbitrary number too early.\n\nFor personal life, my answer is already contained within Question 1: the wider goal is to create purpose, freedom, time leverage, financial strength and the ability to pursue other meaningful things without weakening the core Empire.",
      },
      {
        question: "What level of time and commitment are you realistically prepared to give over the next 1–3 years?",
        answer: "I am prepared to give an extremely high level of time and commitment over the next 1–3 years.\n\nMy main fixed commitment outside the business will be fight training five days per week, roughly from 7:15 am to 8:30 am. It is also important to me that I see my family at least once per week for a couple of hours.\n\nOutside of those commitments, I will work essentially every waking hour toward building the business and wider Empire.\n\nThis is not just what I would ideally like to give; it is what I will give. I understand that this level of commitment will require significant sacrifice, discipline and consistency, and I will operate to that standard.",
      },
      {
        question: "What does sacrifice mean to you when building something ambitious, and what sacrifices are you willing or unwilling to make?",
        answer: "Sacrifice means giving up comfort, leisure, social time and short-term ease in exchange for building the life and organisation I want.\n\nI am willing to sacrifice weekends, free time, comfort and immediate reward. Outside of fight training and making sure I see my family at least once a week, I will give essentially all of my available time to building the business and wider Empire.\n\nI am also willing to accept pressure, delayed financial reward and the reality that the early stages will involve much more practical work than orchestration. Building something monumental will require years of sustained hard work and smart work.\n\nWhat I am not willing to sacrifice is the long-term quality of what is being built. I will not trade standards, structure, good people, sound systems or long-term value for short-term speed or convenience.",
      },
      {
        question: "What does a high standard of work mean to you?",
        answer: "A high standard of work means being in a constant pursuit of the most optimal path while understanding that optimisation can never become an excuse for avoiding hard work. It is not one or the other; it is both.\n\nIt means thinking intelligently about how something should be done, while also being willing to put in the effort required to execute it properly.\n\nIt also means being willing to do work that is repetitive, tedious or uncomfortable when that work is genuinely beneficial to the long-term goal. If something needs to be done properly and creates long-term value, the fact that it is boring or difficult is irrelevant.\n\nA high standard therefore combines intelligent decision-making, discipline, consistency, attention to detail and the willingness to do whatever work the outcome genuinely requires.",
      },
      {
        question: "How should we handle disagreement and conflict between us?",
        answer: "The focal point is respect.\n\nIf there is genuine respect between us, then disagreement does not need to become destructive. Respect means doing the due diligence to understand each other properly — our approach, perceptions, intentions, boundaries, priorities, values, and the things that make each of us tick.\n\nRespect means listening properly before responding. Respect means not assuming bad intent. Respect means being direct and honest without becoming dismissive or hostile. Respect means being willing to question each other while still recognising the value of the person behind the opinion.\n\nA lack of respect is where conflict becomes dangerous. Talking over each other, deliberately misrepresenting someone’s position, ignoring boundaries, allowing ego to override reason, hiding concerns, or treating disagreement as disloyalty would all undermine the relationship.\n\nAs long as respect remains intact, disagreement can actually be useful because it exposes different perspectives and forces better thinking.\n\nFinal authority should still be clear. Where someone has been given responsibility for an area, they should have authority within agreed boundaries. Major strategic or founder-level decisions should remain with the appropriate founder authority.",
      },
      {
        question: "What do you believe you are strongest at, and where could you create the most value?",
        answer: "I truly believe there are no real boundaries in the long run if you genuinely want something badly enough. If I decide that something matters enough, I will keep learning, adapting, working and expanding my capabilities until I can create value in that area.",
      },
      {
        question: "What are your biggest weaknesses or development areas?",
        answer: "Finance is one of my clearest development areas. I need to understand much more of the important day-to-day financial realities that are mandatory for keeping a business healthy and afloat.\n\nI also need to improve how I listen. I can sometimes start finalising someone’s answer in my own head before they have actually finished explaining it, or reach a negative conclusion before I have enough evidence. I need to become more disciplined about hearing the full answer before judging it.\n\nI also need to be more mindful of the different ways people approach problems, work through endeavours, and answer questions. Sometimes the route another person takes to get to their point frustrates me, even when the outcome may still be useful. I need to improve my patience with that.\n\nAnother area is giving people reasonable credit when it is deserved. I want to make sure high standards do not prevent me from properly recognising genuine progress, effort or good performance.\n\nFinally, I need to continue developing the interpersonal skills required to deal professionally with difficult, rude or annoying clients without allowing that behaviour to affect how I operate.\n\nWhere Lewis or Emeka is genuinely stronger than me in an area, I am very willing to learn from them and improve with their help.",
      },
      {
        question: "How do you normally behave under pressure or when something goes wrong?",
        answer: "In genuinely dangerous or high-pressure situations, I have shown that I can slow my mind down and think clearly rather than immediately panic.\n\nOn a business level, I do not yet have enough real operating experience to claim with certainty how I will respond across every type of pressure. That still needs to be tested through experience.\n\nWhat I do know is that I can become frustrated when communication feels unclear, slow or indirect, and that is something I need to manage better. Under pressure, I need to make sure I do not jump to conclusions before I have all the evidence or finish someone else’s answer in my own head before they have actually given it.\n\nThe other two should expect me to take problems seriously, look for a solution quickly, and keep pushing until the issue is resolved, while I continue developing the patience and interpersonal discipline required to handle business pressure well.",
      },
      {
        question: "What do you expect financially from your involvement if the business grows?",
        answer: "As a co-owner, I expect to be rewarded adequately in proportion to the value, responsibility, risk, commitment and sacrifice involved in building something of significant scale.\n\nI will be taking substantial risk, carrying major responsibility and committing an exceptional amount of time and energy to the business. As the business grows and creates greater value, I expect my financial reward to grow naturally alongside that contribution.\n\nMore broadly, I think fair financial reward should depend on how much value someone creates, how much responsibility they carry, how much time and commitment they give, how much risk they take, how important their role is, how much profit and cash the business can sustainably support, and the nature of their relationship with the business — for example, owner, employee or contractor.\n\nThe principle is that reward should reflect genuine contribution and business reality rather than entitlement alone.",
      },
      {
        question: "What behaviour from another person would make you no longer want to build a business with them?",
        answer: "The non-negotiables are already defined in the meeting framework.\n\nThe positive behaviours I expect are reliability and turning up when agreed; clear communication; high standards and pride in work; ownership without needing to be chased; honesty when something goes wrong; ability to take feedback; ability to disagree constructively; problem-solving under pressure; respect for customers and the team; commercial awareness; willingness to learn; and consistency over time.\n\nThe behaviours that would seriously undermine or end the working relationship are repeated lateness or unreliability; poor communication or disappearing when things become difficult; cutting corners that damage quality or reputation; avoiding responsibility when mistakes happen; dishonesty or hiding information; ego preventing collaboration or learning; resentment about workload that was never discussed honestly; financial expectations disconnected from contribution or business reality; low commitment relative to stated ambition; persistent negativity without constructive solutions; treating customers, colleagues or subcontractors poorly; and a major mismatch between long-term ambition and actual willingness to sacrifice.\n\nAbove everything else, loyalty is worth its weight in gold to me. Loyalty is everything. I can work through differences in personality, skill level, experience and approach if the underlying loyalty is genuine. But if trust or loyalty breaks down, the foundation of the working relationship breaks with it. I need to know that the people around me are committed to the team, honest with me, dependable when things become difficult, and not only present when circumstances are easy or beneficial to them.",
      },
      {
        question: "What would need to be true for you to make a deeper long-term commitment to this business and team?",
        answer: "My long-term commitment to the business itself is already solidified, so I would limit this answer to the team.\n\nThe team needs to go through the real experiment of building something difficult together: trials and tribulations, friction, pressure, setbacks, disagreements and all of the other realities that come with attempting something of this magnitude.\n\nThe test of time will show whether the non-negotiable standards we have discussed are genuinely upheld. It will also reveal whether trust and loyalty are real rather than simply spoken about.\n\nFor me, loyalty can only truly be proven when circumstances become difficult. It is easy to appear loyal when everything is going well. The evidence that matters is how people behave when there is pressure, sacrifice, uncertainty, disagreement or adversity.\n\nA deeper long-term commitment to the team will therefore come from accumulated evidence over time that the standards remain intact, people continue to show up, and loyalty survives the difficult periods.",
      },
    ]);
  });

  it("normalises missing evidence to the empty state and keeps legacy People records valid", () => {
    expect(normaliseOperatingProfileSourceSubmissions(undefined)).toEqual([]);
    expect(normaliseOperatingProfileSourceSubmissions([
      calumLeadershipReflectionSubmission,
    ])).toEqual([calumLeadershipReflectionSubmission]);
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

  it("normalises repeated source IDs without leaving duplicate evidence records", () => {
    expect(normaliseOperatingProfileSourceSubmissions([
      lewisLeadershipAlignmentSubmission,
      emekaLeadershipAlignmentSubmission,
      lewisLeadershipAlignmentSubmission,
    ])).toEqual([
      lewisLeadershipAlignmentSubmission,
      emekaLeadershipAlignmentSubmission,
    ]);
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

  const founderSubmissions = [
        calumLeadershipReflectionSubmission,
        lewisLeadershipAlignmentSubmission,
        emekaLeadershipAlignmentSubmission,
      ];

      it("provides all twelve dimensions for Calum, Lewis and Emeka using deterministic evidence-linked records", () => {
        expect(founderIndividualOperatingUnderstandings).toHaveLength(3);
        founderIndividualOperatingUnderstandings.forEach((seed, index) => {
          const submission = founderSubmissions[index];
          expect(seed.respondentName).toBe(submission.respondentName);
          expect(submission.id).toBe(index === 0
            ? "fg-exterior-care-leadership-alignment-calum-2026-09-27"
            : `fg-exterior-care-leadership-alignment-${seed.respondentName.toLowerCase()}`);
          expect(seed.understandings).toHaveLength(12);
          expect(seed.understandings.map(({ dimension }) => dimension)).toEqual(
            individualOperatingDimensions.map(({ key }) => key),
          );
          seed.understandings.forEach((item, answerIndex) => {
            expect(item.id).toBe(`${submission.id}:individual-understanding:${item.dimension}`);
            expect(item.understanding).toMatchObject({
              id: `${item.id}:grounded`,
              status: "evidence-grounded-understanding",
              sourceSubmissionIds: [submission.id],
              sourceAnswerReferences: [{
                sourceSubmissionId: submission.id,
                answerIndexes: submission === calumLeadershipReflectionSubmission
                  && item.dimension === "desired-future"
                  ? [0, 1]
                  : [answerIndex],
              }],
            });
            expect(item.understanding.statement).not.toBe(
              submission.answers[answerIndex].answer,
            );
            const reference = item.understanding.sourceAnswerReferences[0];
            expect(reference.answerIndexes.every((sourceAnswerIndex) => (
              Number.isInteger(sourceAnswerIndex) && sourceAnswerIndex >= 0
                && sourceAnswerIndex < submission.answers.length
            ))).toBe(true);
            expect(item.interpretations).toEqual([]);
            expect(item).not.toHaveProperty("score");
            expect(item.understanding).not.toHaveProperty("score");
          });

          expect(calumLeadershipReflectionSubmission.answers.map(({ question }) => question)).toEqual([
            "What do you ultimately want from building a business?",
            "Where do you genuinely want to be in 5–10 years?",
            "What level of time and commitment are you realistically prepared to give over the next 1–3 years?",
            "What does sacrifice mean to you when building something ambitious, and what sacrifices are you willing or unwilling to make?",
            "What does a high standard of work mean to you?",
            "How should we handle disagreement and conflict between us?",
            "What do you believe you are strongest at, and where could you create the most value?",
            "What are your biggest weaknesses or development areas?",
            "How do you normally behave under pressure or when something goes wrong?",
            "What do you expect financially from your involvement if the business grows?",
            "What behaviour from another person would make you no longer want to build a business with them?",
            "What would need to be true for you to make a deeper long-term commitment to this business and team?",
          ]);
          expect(calumLeadershipReflectionSubmission.answers[0].answer).toContain(
            "That desired lifestyle comes with a very high level of responsibility.",
          );
          expect(calumLeadershipReflectionSubmission.answers[11].answer).toContain(
            "loyalty survives the difficult periods.",
          );
        });

        expect(founderIndividualOperatingUnderstandings[0].understandings[1]
          .understanding.sourceAnswerReferences).toEqual([{
          sourceSubmissionId: calumLeadershipReflectionSubmission.id,
          answerIndexes: [0, 1],
        }]);
      });

      it("distinguishes evidence-grounded syntheses from supported interpretations", () => {
        const understanding = founderIndividualOperatingUnderstandings[2].understandings[8];
        const interpretation = {
          id: "emeka-pressure-interpretation",
          status: "supported-interpretation" as const,
          statement: "A broader, cautiously framed conclusion.",
          sourceSubmissionIds: [emekaLeadershipAlignmentSubmission.id],
          sourceAnswerReferences: [{
            sourceSubmissionId: emekaLeadershipAlignmentSubmission.id,
            answerIndexes: [8],
          }],
        };
        const [normalised] = normaliseIndividualOperatingUnderstandings(
          [{
            ...understanding,
            interpretations: [interpretation],
          }],
          [emekaLeadershipAlignmentSubmission],
        );

        expect(normalised.understanding.status).toBe("evidence-grounded-understanding");
        expect(normalised.understanding.statement).toBe(understanding.understanding.statement);
        expect(normalised.interpretations).toEqual([interpretation]);
        expect(normalised.interpretations[0].status).toBe("supported-interpretation");
        expect(normalised.understanding.sourceAnswerReferences).toEqual([{
          sourceSubmissionId: emekaLeadershipAlignmentSubmission.id,
          answerIndexes: [8],
        }]);
      });

      it("keeps Calum's document provenance attached to the exact source evidence", () => {
        const calumSeed = founderIndividualOperatingUnderstandings[0];
        const sourceSubmission = calumLeadershipReflectionSubmission;

        expect(sourceSubmission.sourceReference).toContain(
          "FG_Exterior_Care_Calum_Leadership_Reflection_27_Sep_2026.docx",
        );
        expect(sourceSubmission.sourceReference).toContain("tightened for clarity, but not softened");
        calumSeed.understandings.forEach((item) => {
          expect(item.understanding.sourceSubmissionIds).toEqual([sourceSubmission.id]);
        });
      });

      it("leaves an unsupported statement unresolved when its source submission is missing", () => {
        const unsupportedUnderstanding: IndividualOperatingUnderstanding = {
          id: "unresolved-without-source",
          dimension: "pressure-and-setbacks",
          understanding: {
            id: "claim-with-missing-source",
            status: "evidence-grounded-understanding",
            statement: "An unsupported assertion.",
            sourceSubmissionIds: ["missing-source"],
            sourceAnswerReferences: [{
              sourceSubmissionId: "missing-source",
              answerIndexes: [0],
            }],
          },
          interpretations: [{
            id: "interpretation-with-missing-source",
            status: "supported-interpretation",
            statement: "An unsupported interpretation.",
            sourceSubmissionIds: ["missing-source"],
            sourceAnswerReferences: [{
              sourceSubmissionId: "missing-source",
              answerIndexes: [0],
            }],
          }],
        };

        const unreferencedUnderstanding: IndividualOperatingUnderstanding = {
          ...unsupportedUnderstanding,
          id: "unreferenced-understanding",
          understanding: {
            ...unsupportedUnderstanding.understanding,
            id: "claim-without-source",
            sourceSubmissionIds: [],
            sourceAnswerReferences: [],
          },
          interpretations: [],
        };
        const invalidAnswerReference: IndividualOperatingUnderstanding = {
          ...unsupportedUnderstanding,
          id: "invalid-answer-reference",
          understanding: {
            ...unsupportedUnderstanding.understanding,
            id: "claim-with-invalid-answer",
            sourceSubmissionIds: [calumLeadershipReflectionSubmission.id],
            sourceAnswerReferences: [{
              sourceSubmissionId: calumLeadershipReflectionSubmission.id,
              answerIndexes: [99],
            }],
          },
          interpretations: [],
        };
        const normalised = normaliseIndividualOperatingUnderstandings(
          [unsupportedUnderstanding, unreferencedUnderstanding, invalidAnswerReference],
          founderSubmissions,
        );

        expect(normalised.map(({ id, understanding, interpretations }) => ({
          id,
          understanding,
          interpretations,
        }))).toEqual([
          {
            id: "unresolved-without-source",
            understanding: {
              id: "claim-with-missing-source",
              status: "unresolved",
              statement: "",
              sourceSubmissionIds: [],
              sourceAnswerReferences: [],
            },
            interpretations: [{
              id: "interpretation-with-missing-source",
              status: "unresolved",
              statement: "",
              sourceSubmissionIds: [],
              sourceAnswerReferences: [],
            }],
          },
          {
            id: "unreferenced-understanding",
            understanding: {
              id: "claim-without-source",
              status: "unresolved",
              statement: "",
              sourceSubmissionIds: [],
              sourceAnswerReferences: [],
            },
            interpretations: [],
          },
          {
            id: "invalid-answer-reference",
            understanding: {
              id: "claim-with-invalid-answer",
              status: "unresolved",
              statement: "",
              sourceSubmissionIds: [],
              sourceAnswerReferences: [],
            },
            interpretations: [],
          },
        ]);
      });

      it("does not treat a literal-source status as an evidence-grounded synthesis", () => {
        const item = founderIndividualOperatingUnderstandings[0].understandings[0];
        const legacyLiteralClaim = {
          ...item,
          understanding: {
            ...item.understanding,
            status: "directly-stated",
          },
        };
        const [normalised] = normaliseIndividualOperatingUnderstandings(
          [legacyLiteralClaim],
          [calumLeadershipReflectionSubmission],
        );

        expect(normalised.understanding).toEqual({
          id: item.understanding.id,
          status: "unresolved",
          statement: "",
          sourceSubmissionIds: [],
          sourceAnswerReferences: [],
        });
      });

      it("supports evidence from multiple submissions without replacing prior understandings", () => {
        const laterCalumSubmission: OperatingProfileSourceSubmission = {
          ...calumLeadershipReflectionSubmission,
          id: "fg-exterior-care-leadership-alignment-calum-2027-09-27",
          answers: [{ question: "Later evidence", answer: "A later self-report." }],
        };
        const updatedDimension: IndividualOperatingUnderstanding = {
          id: "calum-updated-motivation",
          dimension: "ultimate-motivation",
          understanding: {
            id: "calum-updated-motivation-direct",
            status: "evidence-grounded-understanding",
            statement: "A later source and the original source are both considered.",
            sourceSubmissionIds: [
              calumLeadershipReflectionSubmission.id,
              laterCalumSubmission.id,
            ],
            sourceAnswerReferences: [
              { sourceSubmissionId: calumLeadershipReflectionSubmission.id, answerIndexes: [0] },
              { sourceSubmissionId: laterCalumSubmission.id, answerIndexes: [0] },
            ],
          },
          interpretations: [{
            id: "calum-supported-interpretation",
            status: "supported-interpretation",
            statement: "This cautious interpretation is separate from the first-hand statements.",
            sourceSubmissionIds: [
              calumLeadershipReflectionSubmission.id,
              laterCalumSubmission.id,
            ],
            sourceAnswerReferences: [
              { sourceSubmissionId: calumLeadershipReflectionSubmission.id, answerIndexes: [0] },
              { sourceSubmissionId: laterCalumSubmission.id, answerIndexes: [0] },
            ],
          }],
        };
        const sources = [...founderSubmissions, laterCalumSubmission];
        const merged = mergeIndividualOperatingUnderstandings(
          founderIndividualOperatingUnderstandings[0].understandings,
          [updatedDimension],
          sources,
        );

        expect(merged).toHaveLength(13);
        expect(merged[0]).toEqual(founderIndividualOperatingUnderstandings[0].understandings[0]);
        expect(merged[merged.length - 1].understanding.sourceSubmissionIds).toEqual([
          calumLeadershipReflectionSubmission.id,
          laterCalumSubmission.id,
        ]);
        expect(merged[merged.length - 1].interpretations).toEqual(updatedDimension.interpretations);
      });

      it("preserves later derived interpretations when the initial understanding is reattached", () => {
        const seed = founderIndividualOperatingUnderstandings[0];
        const firstUnderstanding = seed.understandings[0];
        const laterInterpretation = {
          id: `${firstUnderstanding.id}:interpretation-1`,
          status: "supported-interpretation" as const,
          statement: "A separately recorded, evidence-linked interpretation.",
          sourceSubmissionIds: [calumLeadershipReflectionSubmission.id],
          sourceAnswerReferences: [{
            sourceSubmissionId: calumLeadershipReflectionSubmission.id,
            answerIndexes: [0],
          }],
        };
        const existingUnderstandings = [
          { ...firstUnderstanding, interpretations: [laterInterpretation] },
          ...seed.understandings.slice(1),
        ];
        const merged = mergeIndividualOperatingUnderstandings(
          existingUnderstandings,
          seed.understandings,
          [calumLeadershipReflectionSubmission],
        );

        expect(merged[0].understanding).toEqual(firstUnderstanding.understanding);
        expect(merged[0].interpretations).toEqual([laterInterpretation]);
        expect(merged).toHaveLength(12);
      });

      it("attaches shared understanding data without changing source answers or People fields", () => {
        const person: TestPerson = {
          id: "person-calum",
          name: "Calum",
          responsibilities: "Existing responsibilities",
          authority: "Existing authority",
          operatingProfile: {
            sourceSubmissions: [calumLeadershipReflectionSubmission],
          },
        };
        const personSnapshot = structuredClone(person);
        const sourceSnapshot = structuredClone(calumLeadershipReflectionSubmission);
        const seed = founderIndividualOperatingUnderstandings[0];
        const result = attachIndividualOperatingUnderstandings(
          [person],
          seed,
          (candidate) => candidate.name,
          (candidate) => candidate.operatingProfile?.sourceSubmissions,
          (candidate) => candidate.operatingProfile?.individualUnderstandings,
          (candidate, individualUnderstandings) => ({
            ...candidate,
            operatingProfile: {
              ...candidate.operatingProfile,
              individualUnderstandings,
            },
          }),
        );

        expect(result.status).toBe("attached");
        expect(result.people[0].responsibilities).toBe("Existing responsibilities");
        expect(result.people[0].authority).toBe("Existing authority");
        expect(result.people[0].operatingProfile?.sourceSubmissions).toEqual(
          person.operatingProfile?.sourceSubmissions,
        );
        expect(result.people[0].operatingProfile?.individualUnderstandings).toEqual(seed.understandings);
        expect(person).toEqual(personSnapshot);
        expect(calumLeadershipReflectionSubmission).toEqual(sourceSnapshot);
      });

      it("reports missing and ambiguous people through the reusable understanding attachment helper", () => {
        const seed = founderIndividualOperatingUnderstandings[0];
        const noMatchPeople: TestPerson[] = [
          { id: "person-lewis", name: "Lewis", responsibilities: "", authority: "" },
        ];
        const noMatch = attachIndividualOperatingUnderstandings(
          noMatchPeople,
          seed,
          (person) => person.name,
          (person) => person.operatingProfile?.sourceSubmissions,
          (person) => person.operatingProfile?.individualUnderstandings,
          (person, individualUnderstandings) => ({
            ...person,
            operatingProfile: { ...person.operatingProfile, individualUnderstandings },
          }),
        );
        const ambiguousPeople: TestPerson[] = [
          { id: "person-calum-one", name: "Calum", responsibilities: "", authority: "" },
          { id: "person-calum-two", name: " calum ", responsibilities: "", authority: "" },
        ];
        const ambiguous = attachIndividualOperatingUnderstandings(
          ambiguousPeople,
          seed,
          (person) => person.name,
          (person) => person.operatingProfile?.sourceSubmissions,
          (person) => person.operatingProfile?.individualUnderstandings,
          (person, individualUnderstandings) => ({
            ...person,
            operatingProfile: { ...person.operatingProfile, individualUnderstandings },
          }),
        );

        expect(noMatch.status).toBe("person-not-found");
        expect(ambiguous.status).toBe("ambiguous-person");
        expect(ambiguous.people).toEqual(ambiguousPeople);
      });

      it("is deterministic across repeated persistence and hydration", () => {
        const storage = memoryStorage();
        const calum: TestPerson = {
          id: "person-calum",
          name: "Calum",
          responsibilities: "Unchanged",
          authority: "Unchanged",
          operatingProfile: { sourceSubmissions: [calumLeadershipReflectionSubmission] },
        };
        const seed = founderIndividualOperatingUnderstandings[0];
        const attachSeed = (person: TestPerson) => attachIndividualOperatingUnderstandings(
          [person],
          seed,
          (candidate) => candidate.name,
          (candidate) => candidate.operatingProfile?.sourceSubmissions,
          (candidate) => candidate.operatingProfile?.individualUnderstandings,
          (candidate, individualUnderstandings) => ({
            ...candidate,
            operatingProfile: { ...candidate.operatingProfile, individualUnderstandings },
          }),
        );
        const first = attachSeed(calum);
        persistJsonArray(storage, "people", first.people);
        const stored = JSON.parse(storage.getItem("people") || "[]") as TestPerson[];
        const second = attachSeed(stored[0]);
        const third = attachSeed(second.people[0]);

        expect(second.people[0].operatingProfile?.individualUnderstandings)
          .toEqual(first.people[0].operatingProfile?.individualUnderstandings);
        expect(third.people[0].operatingProfile?.individualUnderstandings)
          .toEqual(second.people[0].operatingProfile?.individualUnderstandings);
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

  it("persists and rehydrates Calum's source wording and provenance", () => {
    const storage = memoryStorage();
    const people: TestPerson[] = [{
      id: "person-calum",
      name: "Calum",
      responsibilities: "Unchanged",
      authority: "Unchanged",
    }];
    const attached = attach(people, calumLeadershipReflectionSubmission);
    persistJsonArray(storage, "people", attached.people);

    const storedPeople = JSON.parse(storage.getItem("people") || "[]") as TestPerson[];
    const rehydrated = attach(storedPeople, calumLeadershipReflectionSubmission);

    expect(rehydrated.status).toBe("attached");
    expect(rehydrated.people[0].operatingProfile?.sourceSubmissions).toEqual([
      calumLeadershipReflectionSubmission,
    ]);
    expect(rehydrated.people[0].operatingProfile?.sourceSubmissions?.[0].sourceReference)
      .toBe(calumLeadershipReflectionSubmission.sourceReference);
  });

  it("replaces a repeated submission deterministically without duplicating it", () => {
    const submissions = [
      lewisLeadershipAlignmentSubmission,
      emekaLeadershipAlignmentSubmission,
      calumLeadershipReflectionSubmission,
    ];
    const once = mergeOperatingProfileSourceSubmissions([], submissions);
    const twice = mergeOperatingProfileSourceSubmissions(once, submissions);

    expect(twice).toEqual(once);
    expect(twice).toHaveLength(3);
    expect(new Set(twice.map((submission) => submission.id)).size).toBe(3);
  });

  it("retains an earlier submission when the same person submits a later version with a new ID", () => {
    const laterSubmission: OperatingProfileSourceSubmission = {
      ...calumLeadershipReflectionSubmission,
      id: "fg-exterior-care-leadership-alignment-calum-2027-09-27",
      answers: [{ question: "Later question", answer: "Later first-hand evidence." }],
    };
    const submissions = mergeOperatingProfileSourceSubmissions(
      [calumLeadershipReflectionSubmission],
      [laterSubmission],
    );

    expect(submissions).toEqual([calumLeadershipReflectionSubmission, laterSubmission]);
    expect(submissions[0].answers).toEqual(calumLeadershipReflectionSubmission.answers);
  });

  it("replaces a same-ID submission deterministically as the explicit merge rule", () => {
    const replacement: OperatingProfileSourceSubmission = {
      ...lewisLeadershipAlignmentSubmission,
      answers: [{ question: "Updated source", answer: "Updated source response." }],
    };
    const merged = mergeOperatingProfileSourceSubmissions(
      [lewisLeadershipAlignmentSubmission],
      [replacement],
    );

    expect(merged).toEqual([replacement]);
  });

  it("does not mutate existing profile data or the submitted source object", () => {
    const originalSubmission = structuredClone(calumLeadershipReflectionSubmission);
    const originalPerson: TestPerson = {
      id: "person-calum",
      name: "Calum",
      responsibilities: "Unchanged",
      authority: "Unchanged",
      operatingProfile: {
        sourceSubmissions: [],
        communicationStyle: { value: "Existing observation", evidence: "Existing evidence" },
      },
    };
    const originalPersonSnapshot = structuredClone(originalPerson);

    attach([originalPerson], calumLeadershipReflectionSubmission);

    expect(calumLeadershipReflectionSubmission).toEqual(originalSubmission);
    expect(originalPerson).toEqual(originalPersonSnapshot);
  });

  it("supports the same evidence structure for another person without Lewis-specific fields", () => {
    const anotherSubmission: OperatingProfileSourceSubmission = {
      id: "fg-exterior-care-leadership-alignment-jordan",
      respondentName: "Jordan",
      sourceTitle: "FG Exterior Care Leadership Alignment",
      answers: [{ question: "What matters to you?", answer: "A source-backed response." }],
    };
    const jordan: TestPerson = {
      id: "person-jordan",
      name: "Jordan",
      responsibilities: "",
      authority: "",
    };

    const result = attach([jordan], anotherSubmission);

    expect(result.status).toBe("attached");
    expect(result.people[0].operatingProfile?.sourceSubmissions).toEqual([anotherSubmission]);
  });

  it("attaches all three founders through the same source-evidence structure", () => {
    const founders: TestPerson[] = [
      { id: "person-calum", name: "Calum", responsibilities: "Calum role", authority: "Calum authority" },
      { id: "person-lewis", name: "Lewis", responsibilities: "Lewis role", authority: "Lewis authority" },
      { id: "person-emeka", name: "Emeka", responsibilities: "Emeka role", authority: "Emeka authority" },
    ];
    const submissions = [
      calumLeadershipReflectionSubmission,
      lewisLeadershipAlignmentSubmission,
      emekaLeadershipAlignmentSubmission,
    ];
    let allAttached = true;
    const attachedPeople = submissions.reduce((currentPeople, submission) => {
      const attachment = attach(currentPeople, submission);
      if (attachment.status !== "attached") allAttached = false;
      return attachment.people;
    }, founders);

    expect(allAttached).toBe(true);
    expect(attachedPeople.map((person) => person.operatingProfile?.sourceSubmissions)).toEqual(
      submissions.map((submission) => [submission]),
    );
    expect(attachedPeople.map(({ responsibilities, authority }) => [responsibilities, authority])).toEqual([
      ["Calum role", "Calum authority"],
      ["Lewis role", "Lewis authority"],
      ["Emeka role", "Emeka authority"],
    ]);
  });

  it("keeps source submissions distinct from derived dimensions and preserves evidence references", () => {
    const person: TestPerson = {
      id: "person-calum",
      name: "Calum",
      responsibilities: "Unchanged",
      authority: "Unchanged",
      operatingProfile: {
        sourceSubmissions: [],
        communicationStyle: {
          value: "Existing derived observation",
          evidence: "Existing derived evidence",
          sourceSubmissionIds: ["prior-source-id"],
        },
      },
    };
    const original = structuredClone(person);
    const originalSubmission = structuredClone(calumLeadershipReflectionSubmission);
    const result = attach([person], calumLeadershipReflectionSubmission);

    expect(result.people[0].operatingProfile?.sourceSubmissions).toEqual([
      calumLeadershipReflectionSubmission,
    ]);
    expect(result.people[0].operatingProfile?.communicationStyle).toEqual(
      original.operatingProfile?.communicationStyle,
    );
    expect(person).toEqual(original);
    expect(calumLeadershipReflectionSubmission).toEqual(originalSubmission);
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
