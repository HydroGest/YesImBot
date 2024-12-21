/**
 * Get current temperature at a location.
 * @param location The location to get the temperature for, in the format "City, State, Country".
 * @param unit The unit to return the temperature in. Defaults to "celsius". (choices: ["celsius", "fahrenheit"])
 * 
 * @returns the temperature, the location, and the unit in a object
 */
function get_current_temperature(location: string, unit?: string) {
  if (!unit) unit = "celsius";
  return {
    temperature: 26.1,
    location: location,
    unit: unit,
  };
}


/**
 * Get temperature at a location and date.
 * @param location The location to get the temperature for, in the format "City, State, Country".
 * @param date The date to get the temperature for, in the format "Year-Month-Day".
 * @param unit The unit to return the temperature in. Defaults to "celsius". (choices: ["celsius", "fahrenheit"])
 * 
 * @returns the temperature, the location, the date and the unit in a object
 */
export function get_temperature_date(
  location: string,
  date: string,
  // 这种可选参数的写法会将 unit 识别为 required
  unit: string = "celsius"
) {
  return {
    temperature: 25.9,
    location: location,
    date: date,
    unit: unit,
  };
}