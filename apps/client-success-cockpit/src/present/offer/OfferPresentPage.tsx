import { Navigate, useParams } from "react-router";
import PresentPage from "../PresentPage";
import { deckOfOffer, isOfferKey } from "./kinds";
export default function OfferPresentPage({
  notes = false,
}: {
  notes?: boolean;
}) {
  const { offer, key = "" } = useParams();
  return isOfferKey(offer) ? (
    <PresentPage key={offer} deck={deckOfOffer(offer)} notes={notes} />
  ) : (
    <Navigate replace to={`/clients/${encodeURIComponent(key)}`} />
  );
}
