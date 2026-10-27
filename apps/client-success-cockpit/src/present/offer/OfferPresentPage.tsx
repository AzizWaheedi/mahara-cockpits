import { Navigate, useParams } from "react-router";
import PresentPage from "../PresentPage";
export default function OfferPresentPage({
  notes = false,
}: {
  notes?: boolean;
}) {
  const { offer, key = "" } = useParams();
  return offer === "website" ? (
    <PresentPage deck="offer_website" notes={notes} />
  ) : (
    <Navigate replace to={`/clients/${encodeURIComponent(key)}`} />
  );
}
