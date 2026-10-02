// Sequence-diagram fixtures for the importer's tests.

// The enrolment flow from the WS4 spike (ordo-mermaid-spike/mermaidSource.js),
// verbatim: activations, a re-entrant one, interleaved spans, and a `par`
// holding an `alt` and a `loop`.
export const ENROLMENT = `
sequenceDiagram
    participant App as Mobile/Web App
    participant Widget as Eligibility Widget
    participant TokenX as TokenX
    participant Backend as Enrolment Orchestrator (ConsumerAPI/EnrolmentService)
    participant Eligibility as Eligibility API
    participant Payment as Payment Service
    participant PreAuth as Pre-Auth UI
    participant Kafka as Kafka
    participant Consumer as Consumer API

    App->>Widget: Load enrolment eligibility widget
    activate Widget
    Widget->>TokenX: Consumer enters card number
    activate TokenX
    TokenX-->>Widget: Card token
    deactivate TokenX
    Widget->>Backend: Submit token
    activate Backend
    Backend->>Backend: Create enrolment session
    Backend->>Eligibility: Check eligibility (token)
    activate Eligibility
    Eligibility->>Eligibility: De-tokenise card
    Eligibility-->>Backend: dealId + hashed PAN
    deactivate Eligibility
    Backend->>Consumer: Check hashed PAN exists
    activate Consumer
    Consumer-->>Backend: Result (not found / found on dummy account)
    deactivate Consumer
    Backend->>Payment: Initiate payment session (consumerId, enrolmentSessionId, tokenised PAN)
    activate Payment
    Payment-->>Backend: Pre-auth URL
    Backend-->>Widget: Pre-auth URL
    deactivate Backend
    Widget-->>App: postMessage (pre-auth URL)
    deactivate Widget
    App->>PreAuth: Open pre-auth iframe
    activate PreAuth
    PreAuth->>PreAuth: Consumer completes pre-auth

    par Backend (async)
        Payment->>Kafka: Emit payment success event (enrolmentSessionId)
        deactivate Payment
        activate Kafka
        Kafka->>Backend: Consume event
        deactivate Kafka
        activate Backend
        alt PAN not in system (enrolment)
            Backend->>Consumer: Create membership + store hashed PAN
        else PAN on dummy account (transfer)
            Backend->>Consumer: Transfer membership + PANDetails to logged-in consumer
        end
        activate Consumer
        Consumer->>Backend: Mark enrolment session completed
        deactivate Consumer
    and Frontend (polling)
        App->>App: Close pre-auth iframe
        deactivate PreAuth
        loop Poll session status
            App->>Backend: GET enrolment session status
            activate Backend
            Backend-->>App: Status (pending / completed)
            deactivate Backend
        end
    end
    deactivate Backend

    App->>App: Navigate to app with active membership
`;

// The same flow with every activation that CAN be written as `->>+` / `-->>-`
// written that way. The rest stay explicit: one message cannot both
// deactivate its sender and activate its receiver, and an activation that
// follows an `end` or another participant's message has no arrow to ride on.
export const ENROLMENT_SHORTHAND = `
sequenceDiagram
    participant App as Mobile/Web App
    participant Widget as Eligibility Widget
    participant TokenX as TokenX
    participant Backend as Enrolment Orchestrator (ConsumerAPI/EnrolmentService)
    participant Eligibility as Eligibility API
    participant Payment as Payment Service
    participant PreAuth as Pre-Auth UI
    participant Kafka as Kafka
    participant Consumer as Consumer API

    App->>+Widget: Load enrolment eligibility widget
    Widget->>+TokenX: Consumer enters card number
    TokenX-->>-Widget: Card token
    Widget->>+Backend: Submit token
    Backend->>Backend: Create enrolment session
    Backend->>+Eligibility: Check eligibility (token)
    Eligibility->>Eligibility: De-tokenise card
    Eligibility-->>-Backend: dealId + hashed PAN
    Backend->>+Consumer: Check hashed PAN exists
    Consumer-->>-Backend: Result (not found / found on dummy account)
    Backend->>+Payment: Initiate payment session (consumerId, enrolmentSessionId, tokenised PAN)
    Payment-->>Backend: Pre-auth URL
    Backend-->>-Widget: Pre-auth URL
    Widget-->>-App: postMessage (pre-auth URL)
    App->>+PreAuth: Open pre-auth iframe
    PreAuth->>PreAuth: Consumer completes pre-auth

    par Backend (async)
        Payment->>-Kafka: Emit payment success event (enrolmentSessionId)
        activate Kafka
        Kafka->>-Backend: Consume event
        activate Backend
        alt PAN not in system (enrolment)
            Backend->>Consumer: Create membership + store hashed PAN
        else PAN on dummy account (transfer)
            Backend->>Consumer: Transfer membership + PANDetails to logged-in consumer
        end
        activate Consumer
        Consumer->>-Backend: Mark enrolment session completed
    and Frontend (polling)
        App->>App: Close pre-auth iframe
        deactivate PreAuth
        loop Poll session status
            App->>+Backend: GET enrolment session status
            Backend-->>-App: Status (pending / completed)
        end
    end
    deactivate Backend

    App->>App: Navigate to app with active membership
`;

// Notes in every placement Mermaid has — over one lifeline, over two, left of,
// right of — between activations. A stand-in for the spike's Lounge Access
// diagram, whose source was not kept.
export const LOUNGE = `
sequenceDiagram
    actor Traveller
    participant Gate as Lounge Gate
    participant Pass as Pass Service
    participant Wallet as Wallet API
    Traveller->>Gate: Scan boarding pass
    activate Gate
    Note over Gate: Reads barcode and flight number
    Gate->>Pass: Check entitlement
    activate Pass
    Note right of Pass: Tier and partner rules
    Pass->>Wallet: Look up linked card
    Wallet-->>Pass: Card benefits
    Note over Pass,Wallet: Cached for 10 minutes
    Pass-->>Gate: Entitled (guest allowed)
    deactivate Pass
    Note left of Traveller: Waits at the desk
    Gate-->>Traveller: Doors open
    deactivate Gate
`;

// The constructs neither diagram above exercises: a participant box, create
// and destroy, autonumber, rect, critical/option, break, opt, every arrow
// family, an entity code and a title. `box` and `title` labels go through
// DOMPurify while Mermaid parses, so in Node this one needs a DOM.
export const EXTENDED = `
sequenceDiagram
    title Checkout
    autonumber
    box rgb(230, 240, 255) Shop front
      actor U as User
      participant W as Web<br/>App
    end
    participant S as Server
    U->>+W: Start #9829; checkout
    W-->>-U: Basket
    create participant D as Database
    S->>D: Connect
    rect rgb(191, 223, 255)
      U->>S: Pay
    end
    critical Charge card
      S->>S: Authorise
    option Declined
      S-->>U: Declined
    end
    break when the card is blocked
      S-->>U: Blocked
    end
    opt Receipt wanted
      S-)U: Email receipt
    end
    U<<->>S: Sync
    U->>()S: Ping
    U-|\\S: Half arrow
    destroy D
    S-xD: Disconnect
    autonumber off
    U->>S: Unnumbered
`;
