import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { AdBillingReviewPage } from "@/components/AdBillingReview";
import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PublicLayout } from "@/components/PublicLayout";
import { PublicOnlyRoute } from "@/components/PublicOnlyRoute";
import { BillingReviewLayout, RoleRoute } from "@/components/RoleRoute";
import { FormRouteBoundary } from "@/forms/FormBoundary";
import {
  BacklogPage,
  ClientPage,
  ClientsPage,
  EndOfDayPage,
  FirstSignInPage,
  InboxPage,
  KeyLinksPage,
  LandingPage,
  LoginPage,
  MoneyPage,
  NoticesPage,
  SettingsPage,
  SignupPage,
  TodayPage,
} from "@/pages";
import { InvoicesPage } from "@/pages/InvoicesPage";
import { DeckRouteBoundary } from "@/present/DeckBoundary";

/** The client decks, loaded only when a deck window opens. */
const PresentPage = lazy(() => import("@/present/PresentPage"));
const OfferPresentPage = lazy(() => import("@/present/offer/OfferPresentPage"));
const ProposalPage = lazy(() => import("@/pages/money/offers/ProposalPage"));
/** A client's forms (the kickoff first), loaded only when a form window opens. */
const FormWindow = lazy(() => import("@/forms/FormWindow"));
/** The practice client (docs/call-guide/DESIGN.md): its page and its decks. */
const PracticePage = lazy(() => import("@/practice/PracticePage"));
const PracticeDeckPage = lazy(() => import("@/practice/PracticeDeckPage"));

/** An old address, sent on to where its page lives now, with its query string. */
function Moved({ to }: { to: string }) {
  const { search, hash } = useLocation();
  const [path, query = ""] = to.split("?");
  const merged = new URLSearchParams(search);
  for (const [k, v] of new URLSearchParams(query)) merged.set(k, v);
  const qs = merged.toString();
  return <Navigate to={`${path}${qs ? `?${qs}` : ""}${hash}`} replace />;
}

export function AuthenticatedRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<LandingPage />} />
        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
        </Route>
        {/* OTP creates a session before password setup finishes; keep the form mounted. */}
        <Route path="/first-sign-in" element={<FirstSignInPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        {/* Shared billing access does not mount the CSM sidebar or expose CSM pages. */}
        <Route element={<RoleRoute anyOf={["csm", "media_buyer"]} />}>
          <Route element={<BillingReviewLayout />}>
            <Route path="/ad-billing" element={<AdBillingReviewPage />} />
          </Route>
        </Route>
        {/* Sales seats make invoices too (Muhammed, 18 Oct 2026): the same
            page as Money, Invoices, without the CSM sidebar. The sales
            cockpit's Invoices link opens it. */}
        <Route element={<RoleRoute anyOf={["csm", "sales"]} />}>
          <Route element={<BillingReviewLayout wide />}>
            <Route path="/invoices" element={<InvoicesPage />} />
          </Route>
        </Route>
        {/* Notices and routing (D17): the CEO or an admin may give any seat
            the right to change it, so any signed-in seat opens the page; the
            server's viewer and editor gates decide what it shows. No CSM
            sidebar or data provider is mounted for another seat. */}
        <Route element={<BillingReviewLayout />}>
          <Route path="/notices" element={<NoticesPage />} />
        </Route>
        {/* The Brand Blueprint call (docs/brand-blueprint/SPEC.md 4.7): the
            creative director presents it, the CSM reads it. Its static
            segment outranks :deck below, so the onboarding and launch decks
            stay CSM-only; cockpit_blueprint_gate_for_actor decides who may
            write. */}
        <Route element={<RoleRoute anyOf={["csm", "creative"]} />}>
          <Route
            path="/clients/:key/present/blueprint"
            element={
              <DeckRouteBoundary>
                <Suspense fallback={null}>
                  <PresentPage deck="blueprint" />
                </Suspense>
              </DeckRouteBoundary>
            }
          />
          <Route
            path="/clients/:key/present/blueprint/notes"
            element={
              <DeckRouteBoundary>
                <Suspense fallback={null}>
                  <PresentPage deck="blueprint" notes />
                </Suspense>
              </DeckRouteBoundary>
            }
          />
          {/* The practice Blueprint, framed by the creative director's
              practice call page. Made up: nothing is saved or sent. */}
          <Route
            path="/practice/present/blueprint"
            element={
              <DeckRouteBoundary>
                <Suspense fallback={null}>
                  <PracticeDeckPage deck="blueprint" />
                </Suspense>
              </DeckRouteBoundary>
            }
          />
          <Route
            path="/practice/present/blueprint/notes"
            element={
              <DeckRouteBoundary>
                <Suspense fallback={null}>
                  <PracticeDeckPage deck="blueprint" notes />
                </Suspense>
              </DeckRouteBoundary>
            }
          />
        </Route>
        {/* The client decks (CSM decks, 2026-10-19): the CSM seat only, and
            outside AppLayout, so no sidebar, HermesChat or Cmd+K can take
            focus while the deck is shared on a call. */}
        {/* biome-ignore lint/a11y/useValidAriaRole: RoleRoute's role prop is a seat name, not an ARIA role */}
        <Route element={<RoleRoute role="csm" />}>
          <Route
            path="/clients/:key/present/offer/:offer"
            element={
              <DeckRouteBoundary>
                <Suspense fallback={null}>
                  <OfferPresentPage />
                </Suspense>
              </DeckRouteBoundary>
            }
          />
          <Route
            path="/clients/:key/present/offer/:offer/notes"
            element={
              <DeckRouteBoundary>
                <Suspense fallback={null}>
                  <OfferPresentPage notes />
                </Suspense>
              </DeckRouteBoundary>
            }
          />
          <Route
            path="/clients/:key/present/:deck"
            element={
              <DeckRouteBoundary>
                <Suspense fallback={null}>
                  <PresentPage />
                </Suspense>
              </DeckRouteBoundary>
            }
          />
          <Route
            path="/clients/:key/present/:deck/notes"
            element={
              <DeckRouteBoundary>
                <Suspense fallback={null}>
                  <PresentPage notes />
                </Suspense>
              </DeckRouteBoundary>
            }
          />
          {/* The practice client's two decks, outside AppLayout as the
              real decks are. */}
          <Route
            path="/practice/present/:deck"
            element={
              <DeckRouteBoundary>
                <Suspense fallback={null}>
                  <PracticeDeckPage />
                </Suspense>
              </DeckRouteBoundary>
            }
          />
          <Route
            path="/practice/present/:deck/notes"
            element={
              <DeckRouteBoundary>
                <Suspense fallback={null}>
                  <PracticeDeckPage notes />
                </Suspense>
              </DeckRouteBoundary>
            }
          />
          {/* The kickoff form (docs/csm-forms/KICKOFF.md): its own window,
              outside AppLayout for the same reason as the decks. */}
          <Route
            path="/clients/:key/forms/:form"
            element={
              <FormRouteBoundary>
                <Suspense fallback={null}>
                  <FormWindow />
                </Suspense>
              </FormRouteBoundary>
            }
          />
        </Route>
        <Route element={<AppLayout />}>
          {/* biome-ignore lint/a11y/useValidAriaRole: RoleRoute's role prop is a seat name, not an ARIA role */}
          <Route element={<RoleRoute role="csm" />}>
            {/* Five places (the simplification audit, approved 2026-10-06). */}
            <Route path="/dashboard" element={<TodayPage />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/clients/:key" element={<ClientPage />} />
            <Route
              path="/clients/:key/proposals/:id"
              element={
                <DeckRouteBoundary>
                  <Suspense fallback={null}>
                    <ProposalPage />
                  </Suspense>
                </DeckRouteBoundary>
              }
            />
            <Route path="/money" element={<MoneyPage />} />
            <Route path="/links" element={<KeyLinksPage />} />
            {/* Today's own pages. */}
            <Route path="/eod" element={<EndOfDayPage />} />
            <Route path="/backlog" element={<BacklogPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route
              path="/practice"
              element={
                <Suspense fallback={null}>
                  <PracticePage />
                </Suspense>
              }
            />
            {/* The old addresses land where their page lives now, query string
                kept, so a bookmark or a Slack link never breaks. Every page in
                this cockpit is the CSM's: a session minted for another seat
                gets "not yours", not a crashed screen. */}
            <Route path="/tasks" element={<Moved to="/dashboard" />} />
            <Route path="/meetings" element={<Moved to="/inbox" />} />
            <Route
              path="/performance"
              element={<Moved to="/clients?view=results" />}
            />
            <Route
              path="/billing"
              element={<Moved to="/money?tab=billing" />}
            />
            <Route
              path="/projections"
              element={<Moved to="/money?tab=projections" />}
            />
            <Route path="/churn" element={<Moved to="/money?tab=churn" />} />
            <Route path="/hotlist" element={<Moved to="/money?tab=hot" />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function AuthenticatedAppRoutes() {
  return <AuthenticatedRoutes />;
}
