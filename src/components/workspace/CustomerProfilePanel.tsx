import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User, Phone, Mail, MapPin, CreditCard, Building } from "lucide-react";
import { useCustomerProfile } from "@/hooks/useCustomerProfile";

interface CustomerProfilePanelProps {
  phone: string | null;
  isActive: boolean;
}

export function CustomerProfilePanel({
  phone,
  isActive,
}: CustomerProfilePanelProps) {
  const { profile, loading, error } = useCustomerProfile(phone);

  if (!isActive || !phone) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="h-5 w-5" />
            Customer Profile
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Customer info will appear when a contact is active.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="h-5 w-5" />
            Customer Profile
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading profile...</p>
        </CardContent>
      </Card>
    );
  }

  if (error || !profile) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="h-5 w-5" />
            Customer Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            No profile found for <span className="font-mono">{phone}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            This is a new caller. Profile will be created automatically by
            Amazon Connect Customer Profiles.
          </p>
        </CardContent>
      </Card>
    );
  }

  const fullName = [profile.firstName, profile.middleName, profile.lastName]
    .filter(Boolean)
    .join(" ");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <User className="h-5 w-5" />
          Customer Profile
          <Badge variant="secondary" className="ml-auto text-xs">
            ID: {profile.profileId.slice(0, 8)}...
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="text-lg font-semibold">{fullName || "Unknown"}</div>
          {profile.businessName && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Building className="h-3 w-3" />
              {profile.businessName}
            </div>
          )}
        </div>

        <div className="grid gap-2 text-sm">
          {profile.phoneNumber && (
            <div className="flex items-center gap-2">
              <Phone className="h-3 w-3 text-muted-foreground" />
              <span className="font-mono">{profile.phoneNumber}</span>
            </div>
          )}
          {profile.email && (
            <div className="flex items-center gap-2">
              <Mail className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">{profile.email}</span>
            </div>
          )}
          {profile.accountNumber && (
            <div className="flex items-center gap-2">
              <CreditCard className="h-3 w-3 text-muted-foreground" />
              <span className="font-mono text-muted-foreground">
                {profile.accountNumber}
              </span>
            </div>
          )}
          {profile.address && profile.address.City && (
            <div className="flex items-center gap-2">
              <MapPin className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">
                {[profile.address.City, profile.address.State, profile.address.Country]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </div>
          )}
        </div>

        {profile.attributes && Object.keys(profile.attributes).length > 0 && (
          <div className="pt-2 border-t">
            <div className="text-xs text-muted-foreground mb-1">Attributes</div>
            <div className="space-y-1">
              {Object.entries(profile.attributes)
                .slice(0, 5)
                .map(([key, value]) => (
                  <div key={key} className="text-xs">
                    <span className="text-muted-foreground">{key}: </span>
                    <span>{value}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
