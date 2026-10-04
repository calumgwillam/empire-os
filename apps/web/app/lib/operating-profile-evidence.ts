export type OperatingProfileSourceAnswer = {
  question: string;
  answer: string;
};

export type OperatingProfileSourceSubmission = {
  id: string;
  respondentName: string;
  sourceTitle: string;
  sourceReference?: string;
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

export const emekaLeadershipAlignmentSubmission = {
  id: "fg-exterior-care-leadership-alignment-emeka",
  respondentName: "Emeka",
  sourceTitle: "FG Exterior Care Leadership Alignment",
  answers: [
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
  ],
} satisfies OperatingProfileSourceSubmission;

export const calumLeadershipReflectionSubmission = {
  id: "fg-exterior-care-leadership-alignment-calum-2026-09-27",
  respondentName: "Calum",
  sourceTitle: "FG Exterior Care Leadership Alignment",
  sourceReference: "FG_Exterior_Care_Calum_Leadership_Reflection_27_Sep_2026.docx — Questions for the Three of Us — Calum's Answers; answers were \"tightened for clarity, but not softened\".",
  answers: [
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
  ],
} satisfies OperatingProfileSourceSubmission;

export function normaliseOperatingProfileSourceSubmissions(
  value: unknown,
): OperatingProfileSourceSubmission[] {
  if (!Array.isArray(value)) return [];

  const submissionsById = new Map<string, OperatingProfileSourceSubmission>();
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

    submissionsById.set(source.id, {
      id: source.id,
      respondentName: source.respondentName,
      sourceTitle: source.sourceTitle,
      ...(typeof source.sourceReference === "string" ? { sourceReference: source.sourceReference } : {}),
      answers,
    });
  });

  return [...submissionsById.values()];
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
