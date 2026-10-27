import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OFFER_KEYS, OFFER_NAMES, proposalNewUrl } from "@/present/offer/kinds";

export function MakeProposalButton({ taskId }: { taskId: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <FileText size={16} />
          Make a proposal
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OFFER_KEYS.map(offer => (
          <DropdownMenuItem key={offer} asChild>
            <a href={proposalNewUrl(taskId, offer)}>{OFFER_NAMES[offer]}</a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
