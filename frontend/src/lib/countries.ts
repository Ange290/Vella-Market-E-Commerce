/** Destination / residence countries offered at sign-up. Rwanda is the launch market. */
export interface Country {
  code: string
  name: string
  dial: string
}

export const COUNTRIES: Country[] = [
  { code: 'RW', name: 'Rwanda', dial: '+250' },
  { code: 'UG', name: 'Uganda', dial: '+256' },
  { code: 'KE', name: 'Kenya', dial: '+254' },
  { code: 'TZ', name: 'Tanzania', dial: '+255' },
  { code: 'BI', name: 'Burundi', dial: '+257' },
  { code: 'CD', name: 'DR Congo', dial: '+243' },
  { code: 'ZM', name: 'Zambia', dial: '+260' },
  { code: 'GH', name: 'Ghana', dial: '+233' },
  { code: 'NG', name: 'Nigeria', dial: '+234' },
  { code: 'ZA', name: 'South Africa', dial: '+27' },
]

export const countryByCode = (code: string) => COUNTRIES.find((c) => c.code === code)
