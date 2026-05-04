export type Location = {
  id: string;
  user_id: string;
  name: string;
  lat: number;
  lng: number;
  created_at: string;
};

export type Session = {
  id: string;
  user_id: string;
  location_id: string | null;
  lat: number | null;
  lng: number | null;
  started_at: string;
  ended_at: string | null;
  last_tap_at: string;
  finalized: boolean;
  exported_at: string | null;
};

export type Sighting = {
  id: string;
  session_id: string;
  user_id: string;
  species_code: string;
  common_name: string;
  scientific_name: string;
  count: number;
  updated_at: string;
};

export type UserSpecies = {
  id: string;
  user_id: string;
  location_id: string | null;
  species_code: string;
  common_name: string;
  scientific_name: string;
  display_order: number;
  custom_added: boolean;
  created_at: string;
};

export type EbirdRecentObs = {
  speciesCode: string;
  comName: string;
  sciName: string;
  howMany?: number;
  obsDt?: string;
};

export type TaxonomyMatch = {
  speciesCode: string;
  comName: string;
  sciName: string;
  category?: string;
};
