# EMPIRE OS — INITIAL DATA MODEL

## 1. PURPOSE

This document defines the first core data objects Empire OS should understand.

The aim is not to model the entire future empire immediately.

The aim is to create a small number of strong foundational objects that can connect to each other and expand over time.

---

## 2. DESIGN PRINCIPLE

Important organisational information should be treated as structured objects rather than loose notes wherever practical.

Each object should have:

- a clear identity
- a purpose
- a status
- an owner where relevant
- timestamps
- relationships to other objects
- enough history to understand what happened

---

## 3. CORE OBJECT: CAPTURE

Capture is the universal entry point for important information.

A Capture may begin as:

- an idea
- an observation
- a problem
- an opportunity
- a risk
- a lesson
- a note
- a question
- a piece of evidence

The user should not need to fully understand or categorise something before capturing it.

### Core fields

- ID
- Title
- Raw content
- Captured by
- Date/time captured
- Initial type
- Related pillar or area
- Importance
- Status
- Source
- Attachments
- Related objects
- Review notes

### Initial status flow

New

→ Reviewed

→ Converted

or

→ Closed

---

## 4. CORE OBJECT: DECISION

A Decision records an important choice.

### Core fields

- ID
- Decision title
- Decision statement
- Decision maker
- Date
- Context
- Reasoning
- Evidence considered
- Alternatives considered
- Assumptions
- Expected outcome
- Risk level
- Review date
- Actual outcome
- Lessons
- Related objects
- Status

---

## 5. CORE OBJECT: ACTION

An Action represents something that must be done.

### Core fields

- ID
- Title
- Description
- Owner
- Created by
- Created date
- Due date
- Priority
- Status
- Related project
- Related decision
- Related capture
- Related pillar
- Completion evidence
- Completion date

### Initial statuses

Open

→ In Progress

→ Blocked

→ Completed

→ Cancelled

---

## 6. CORE OBJECT: PROJECT

A Project is a coordinated body of work intended to produce a defined outcome.

### Core fields

- ID
- Project name
- Objective
- Owner
- Sponsor
- Pillar or area
- Start date
- Target completion date
- Status
- Expected value
- Risks
- Success criteria
- Actions
- Decisions
- Captures
- Metrics
- Outcomes
- Lessons

---

## 7. CORE OBJECT: PROBLEM

A Problem represents an existing condition that is reducing performance, quality, safety, efficiency, reliability or value.

### Core fields

- ID
- Problem title
- Description
- Reported by
- Date identified
- Affected area
- Severity
- Frequency
- Impact
- Evidence
- Root cause status
- Root cause
- Owner
- Related actions
- Related decisions
- Related systems
- Resolution
- Lessons
- Status

---

## 8. CORE OBJECT: OPPORTUNITY

An Opportunity represents potential upside.

### Core fields

- ID
- Opportunity title
- Description
- Source
- Date identified
- Related pillar or area
- Strategic fit
- Estimated upside
- Required capital
- Required time
- Required capability
- Risks
- Opportunity cost
- Evidence
- Owner
- Status
- Decision
- Outcome

---

## 9. CORE OBJECT: RISK

A Risk represents potential future downside.

### Core fields

- ID
- Risk title
- Description
- Owner
- Area
- Likelihood
- Impact
- Exposure
- Mitigation
- Trigger indicators
- Related projects
- Related decisions
- Related systems
- Review date
- Status

---

## 10. CORE OBJECT: SYSTEM

A System is a repeatable way of producing an organisational outcome.

### Core fields

- ID
- System name
- Purpose
- Owner
- Area
- Inputs
- Process
- Outputs
- Standards
- Related SOPs
- Metrics
- Failure points
- Version
- Last reviewed
- Status

---

## 11. CORE OBJECT: SOP

An SOP defines an approved repeatable procedure.

### Core fields

- ID
- SOP title
- Purpose
- Owner
- Related system
- Applicable roles
- Procedure
- Required tools
- Safety considerations
- Quality standard
- Evidence of completion
- Version
- Effective date
- Review date
- Status

---

## 12. CORE OBJECT: LESSON

A Lesson records knowledge derived from experience.

### Core fields

- ID
- Lesson title
- Description
- Source event
- Date learned
- Pillar or area
- Why it matters
- Recommended change
- Related problem
- Related project
- Related decision
- Related system
- Status

A lesson should ideally lead to an actual system or behaviour change where appropriate.

---

## 13. CORE OBJECT: METRIC

A Metric represents measurable performance or condition.

### Core fields

- ID
- Metric name
- Definition
- Owner
- Area
- Unit
- Target
- Actual
- Measurement frequency
- Data source
- Trend
- Thresholds
- Related objectives
- Related systems
- Status

---

## 14. CORE OBJECT: PERSON

A Person represents someone who participates in the organisation.

### Core fields

- ID
- Name
- Role
- Responsibilities
- Authority
- Manager
- Pillar or area
- Skills
- Development areas
- Performance indicators
- Access level
- Status

Sensitive personal information should be minimised and protected appropriately.

---

## 15. CORE OBJECT: BUSINESS PILLAR

A Business Pillar represents a major operating pillar.

Current pillars:

- Garden Maintenance
- Hard Landscape Construction
- Excavation

### Core fields

- ID
- Name
- Leader
- Strategic objectives
- Projects
- Systems
- People
- Metrics
- Risks
- Opportunities
- Financial performance
- Founder dependency
- Status

---

## 16. RELATIONSHIP PRINCIPLE

Objects should be connected rather than duplicated.

Example:

A Capture identifies a recurring estimating problem.

That Capture becomes a Problem.

The Problem leads to a Decision.

The Decision creates an Action.

The Action updates a System.

The System changes an SOP.

The result is measured through a Metric.

The resulting Lesson is linked back to the original Problem.

This creates traceable organisational learning.

---

## 17. AUDIT HISTORY

Important records should eventually preserve a history of meaningful changes.

The system should be able to answer:

- what changed
- when it changed
- who changed it
- why it changed where relevant

Important historical context should not disappear when records are edited.

---

## 18. SOFT DELETE PRINCIPLE

Important organisational records should generally not be permanently destroyed during normal use.

Where appropriate, records should be archived or marked inactive rather than erased.

This protects organisational memory and auditability.

---

## 19. IDENTIFIERS

Every important object should have a unique internal identifier.

Human-readable names may change.

Identifiers should remain stable.

---

## 20. VERSION 0.1 LIMITATION

This data model is deliberately incomplete.

Future objects may include:

- Customer
- Lead
- Quote
- Job
- Site
- Supplier
- Asset
- Vehicle
- Equipment
- Financial Transaction
- Budget
- Contract
- Incident
- Meeting
- Strategic Objective
- Venture
- Experiment
- Training
- Capability

These should only be formalised when operational requirements justify them.
