import { SQL, Encrypt, Decrypt } from '../app'
import { 
	d, Schema, Property, Description, Retype, Route, Throws, 
	Path, BadRequest, NotFound, AuthorizationFailed, Auth, Query,
	Enum, Ownership, Identifier, Parent, Body, Double, Timestamp
} from '../utils/OpenAPI'
import { IResult } from 'mssql'

import { Type } from './Type'
import { Participant } from './Participant'
import { Study } from './Study'
import { Researcher } from './Researcher'

export enum SensorName {
	// IGNORED: DateOfBirth, Sex, BloodType
	Analytics = 'lamp.analytics',
	Accelerometer = 'lamp.accelerometer',
	Bluetooth = 'lamp.bluetooth',
	Calls = 'lamp.calls',
	ScreenState = 'lamp.screen_state',
	SMS = 'lamp.sms',
	WiFi = 'lamp.wifi',
	Audio = 'lamp.audio_recordings',
	Location = 'lamp.gps',
	ContextualLocation = 'lamp.gps.contextual',
	Height = 'lamp.height',
	Weight = 'lamp.weight',
	HeartRate = 'lamp.heart_rate',
	BloodPressure = 'lamp.blood_pressure',
	RespiratoryRate = 'lamp.respiratory_rate',
	Sleep = 'lamp.sleep',
	Steps = 'lamp.steps',
	Flights = 'lamp.flights',
	Segment = 'lamp.segment',
	Distance = 'lamp.distance',
}
Enum(SensorName, d`
	The kinds of sensors currently available.
`)

@Schema()
@Parent(Participant)
@Description(d`
	An event generated by a participant interacting with the LAMP app.
`)
export class SensorEvent {

	@Property()
	@Description(d`
		The date and time when this event was recorded.
	`)
	public timestamp?: Timestamp

	@Property()
	@Description(d`
		The type of the sensor event.
	`)
	public sensor?: SensorName

	@Property()
	@Description(d`
		The item information recorded within the sensor event.
	`)
	public data?: any

	@Route.POST('/participant/{participant_id}/sensor_event') 
	@Description(d`
		Create a new SensorEvent for the given Participant.
	`)
	@Auth(Ownership.Self | Ownership.Sibling | Ownership.Parent, 'participant_id')
	@Retype(Identifier, SensorEvent)
	@Throws(BadRequest, AuthorizationFailed, NotFound)
	public static async create(

		@Path('participant_id')
		@Retype(Identifier, Participant)
		participant_id: string,

		@Body()
		sensor_event: SensorEvent,

	): Promise<{}> {
		return SensorEvent._insert(participant_id, sensor_event)
	}

	@Route.DELETE('/participant/{participant_id}/sensor_event') 
	@Description(d`
		Delete a sensor event.
	`)
	@Auth(Ownership.Self | Ownership.Sibling | Ownership.Parent, 'sensor_event_id')
	@Retype(Identifier, SensorEvent)
	@Throws(BadRequest, AuthorizationFailed, NotFound)
	public static async delete(

		@Path('participant_id')
		@Retype(Identifier, Participant)
		participant_id: string,

		@Query('limit')
		date_range?: string

	): Promise<{}> {
		let limit = !!date_range ? date_range.split(':', 2).map(x => parseInt(x)) : [undefined, undefined]
		return SensorEvent._delete(participant_id, limit[0], limit[1])
	}

	@Route.GET('/participant/{participant_id}/sensor_event') 
	@Description(d`
		Get the set of all sensor events produced by the given participant.
	`)
	@Auth(Ownership.Self | Ownership.Sibling | Ownership.Parent, 'participant_id')
	@Retype(Array, SensorEvent)
	@Throws(BadRequest, AuthorizationFailed, NotFound)
	public static async all_by_participant(

		@Path('participant_id')
		@Retype(Identifier, Participant)
		participant_id: string,

		@Query('limit')
		date_range?: string

	): Promise<SensorEvent[]> {
		let limit = !!date_range ? date_range.split(':', 2).map(x => parseInt(x)) : [undefined, undefined]
		return SensorEvent._select(participant_id, limit[0], limit[1])
	}

	@Route.GET('/study/{study_id}/sensor_event') 
	@Description(d`
		Get the set of all sensor events produced by participants 
		participants of a single study, by study identifier.
	`)
	@Auth(Ownership.Self | Ownership.Sibling | Ownership.Parent, 'study_id')
	@Retype(Array, SensorEvent)
	@Throws(BadRequest, AuthorizationFailed, NotFound)
	public static async all_by_study(

		@Path('study_id')
		@Retype(Identifier, Study)
		study_id: string,

		@Query('limit')
		date_range?: string

	): Promise<SensorEvent[]> {
		let limit = !!date_range ? date_range.split(':', 2).map(x => parseInt(x)) : [undefined, undefined]
		return SensorEvent._select(study_id, limit[0], limit[1])
	}

	@Route.GET('/researcher/{researcher_id}/sensor_event') 
	@Description(d`
		Get the set of all sensor events produced by participants 
		of any study conducted by a researcher, by researcher identifier.
	`)
	@Auth(Ownership.Self | Ownership.Sibling | Ownership.Parent, 'researcher_id')
	@Retype(Array, SensorEvent)
	@Throws(BadRequest, AuthorizationFailed, NotFound)
	public static async all_by_researcher(

		@Path('researcher_id')
		@Retype(Identifier, Researcher)
		researcher_id: string,

		@Query('limit')
		date_range?: string

	): Promise<SensorEvent[]> {
		let limit = !!date_range ? date_range.split(':', 2).map(x => parseInt(x)) : [undefined, undefined]
		return SensorEvent._select(researcher_id, limit[0], limit[1])
	}

	/**
	 * Get a set of `SensorEvent`s matching the criteria parameters.
	 */
	private static async _select(

		/**
		 * 
		 */
		id?: Identifier,

		/**
		 *
		 */
		from_date?: number,

		/**
		 *
		 */
		to_date?: number

	): Promise<SensorEvent[]> {

		// Get the correctly scoped identifier to search within.
		let user_id: string | undefined
		let admin_id: number | undefined
		if (!!id && Identifier.unpack(id)[0] === (<any>Researcher).name)
			admin_id = Researcher._unpack_id(id).admin_id
		else if (!!id && Identifier.unpack(id)[0] === (<any>Study).name)
			admin_id = Study._unpack_id(id).admin_id
		else if (!!id && Identifier.unpack(id).length === 0 /* Participant */)
			user_id = Participant._unpack_id(id).study_id
		else if(!!id) throw new Error()
		user_id = !!user_id ? Encrypt(user_id) : undefined

		let result1 = (await SQL!.request().query(`
				SELECT timestamp, type, data
				FROM (
					SELECT
						Users.AdminID, 
						Users.StudyId, 
						Users.IsDeleted,
						DATEDIFF_BIG(MS, '1970-01-01', U.CreatedOn) AS timestamp, 
						U.type,
						U.data
					FROM HealthKit_DailyValues
					UNPIVOT (data FOR type IN (
						Height, Weight, HeartRate, BloodPressure, 
						RespiratoryRate, Sleep, Steps, FlightClimbed, 
						Segment, Distance
					)) U
					LEFT JOIN Users
					    ON U.UserID = Users.UserID
					WHERE U.data != ''
					UNION ALL 
					SELECT
						Users.AdminID, 
						Users.StudyId, 
						Users.IsDeleted,
					    DATEDIFF_BIG(MS, '1970-01-01', DateTime) AS timestamp,
					    REPLACE(HKParamName, ' ', '') AS type,
					    Value AS data 
					FROM HealthKit_ParamValues
					LEFT JOIN Users
					    ON HealthKit_ParamValues.UserID = Users.UserID
					LEFT JOIN HealthKit_Parameters
					    ON HealthKit_Parameters.HKParamID = HealthKit_ParamValues.HKParamID
				) X
				WHERE X.IsDeleted = 0
                ${!!user_id ? `AND X.StudyId = '${user_id}'` : ''}
                ${!!admin_id ? `AND X.AdminID = '${admin_id}'` : ''}
                ${!!from_date ? `AND X.timestamp >= ${from_date}` : ''}
                ${!!to_date ? `AND X.timestamp <= ${to_date}` : ''};
		`)).recordset.map((raw: any) => {
			let obj = new SensorEvent()
			obj.timestamp = raw.timestamp
			obj.sensor = <SensorName>Object.entries(HK_LAMP_map).filter(x => x[1] === (<string>raw.type))[0][0]
			obj.data = ((<any>HK_to_LAMP)[obj.sensor!] || ((x: any) => x))(raw.value)
			return obj
		})

		let result2 = (await SQL!.request().query(`
			SELECT 
                DATEDIFF_BIG(MS, '1970-01-01', Locations.CreatedOn) AS timestamp,
                (CASE 
                    WHEN Coordinates IS NOT NULL THEN Coordinates
                    ELSE Locations.Address
                END) AS coordinates,
                (CASE 
                    WHEN Coordinates IS NULL THEN NULL
                    ELSE 1
                END) AS accuracy,
                (NULL) AS location_context,
                (NULL) AS social_context,
                Type AS type,
                LocationName AS location_name 
            FROM Locations
            LEFT JOIN Users
                ON Locations.UserID = Users.UserID
            LEFT JOIN LAMP_Aux.dbo.GPSLookup 
                ON Locations.Address = LAMP_Aux.dbo.GPSLookup.Address
            WHERE IsDeleted = 0 
                ${!!user_id ? `AND Users.StudyId = '${user_id}'` : ''}
                ${!!admin_id ? `AND Users.AdminID = '${admin_id}'` : ''}
                ${!!from_date ? `AND DATEDIFF_BIG(MS, '1970-01-01', Locations.CreatedOn) >= ${from_date}` : ''}
                ${!!to_date ? `AND DATEDIFF_BIG(MS, '1970-01-01', Locations.CreatedOn) <= ${to_date}` : ''};
		`)).recordset.map((raw: any) => {
			let x = toLAMP(raw.location_name)
			let y = (Decrypt(raw.coordinates) || raw.coordinates).split(',').map(parseFloat)
			let obj = new SensorEvent()
			obj.timestamp = raw.timestamp
			obj.sensor = SensorName.ContextualLocation
			obj.data = {
				latitude: y[0],
				longitude: y[1],
				accuracy: raw.accuracy,
				location_context: x[0],
				social_context: x[1]
			}
			return obj
		})

		let result3 = (await SQL!.request().query(`
			SELECT 
				timestamp, sensor_name, data
			FROM LAMP_Aux.dbo.CustomSensorEvent
            LEFT JOIN Users
            	ON CustomSensorEvent.UserID = Users.UserID
			WHERE Users.IsDeleted = 0
	            ${!!user_id ? `AND Users.StudyId = '${user_id}'` : ''}
	            ${!!admin_id ? `AND Users.AdminID = '${admin_id}'` : ''}
	            ${!!from_date ? `AND timestamp >= ${from_date}` : ''}
	            ${!!to_date ? `AND timestamp <= ${to_date}` : ''};
		`)).recordset.map((raw: any) => {
			let obj = new SensorEvent()
			obj.timestamp = raw.timestamp
			obj.sensor = raw.sensor_name
			obj.data = JSON.parse(raw.data)
			return obj
		})

		return [...result1, ...result2, ...result3].sort((a, b) => (<number>a.timestamp) - (<number>b.timestamp))
	}

	/**
	 * Create a `SensorEvent` with a new object.
	 */
	private static async _insert(

		/**
		 * The `StudyId` column of the `Users` table in the LAMP v0.1 DB.
		 */
		participant_id: Identifier,

		/**
		 * The new object.
		 */
		object: SensorEvent

	): Promise<{}> {
	    return (await SQL!.request().query(`
            INSERT INTO LAMP_Aux.dbo.CustomSensorEvent (
                UserID, timestamp, sensor_name, data
            )
            VALUES (
                (SELECT UserID FROM Users WHERE StudyId = '${Encrypt(Participant._unpack_id(participant_id).study_id)}'), 
                ${object.timestamp!}, 
                '${object.sensor}', 
                '${JSON.stringify(object.data)}'
            );
	    `)).recordset
	}

	/**
	 * Delete a `SensorEvent` row.
	 */
	private static async _delete(

		/**
		 * The `StudyId` column of the `Users` table in the LAMP v0.1 DB.
		 */
		participant_id: Identifier,

		/**
		 *
		 */
		from_date?: number,

		/**
		 *
		 */
		to_date?: number

	): Promise<{}> {
		let user_id = Encrypt(Participant._unpack_id(participant_id).study_id);

		// TODO: Deletion is not supported! EditedOn is not correctly used here.
		// FIXME

		(await SQL!.request().query(`
			UPDATE HealthKit_DailyValues 
            LEFT JOIN Users
                ON HealthKit_DailyValues.UserID = Users.UserID
			SET EditedOn = NULL 
			WHERE Users.StudyId = ${user_id}
                ${!!from_date ? `AND DATEDIFF_BIG(MS, '1970-01-01', HealthKit_DailyValues.CreatedOn) >= ${from_date}` : ''}
                ${!!to_date ? `AND DATEDIFF_BIG(MS, '1970-01-01', HealthKit_DailyValues.CreatedOn) <= ${to_date}` : ''}
		`)).recordset;
		(await SQL!.request().query(`
			UPDATE Locations 
            LEFT JOIN Users
                ON Locations.UserID = Users.UserID
			SET Type = 0 
			WHERE Users.StudyId = ${user_id}
                ${!!from_date ? `AND DATEDIFF_BIG(MS, '1970-01-01', Locations.CreatedOn) >= ${from_date}` : ''}
                ${!!to_date ? `AND DATEDIFF_BIG(MS, '1970-01-01', Locations.CreatedOn) <= ${to_date}` : ''}
		`)).recordset;
		return {}
	}
}

/**
 *
 */
export enum LocationContext {
	Home = 'home',
	School = 'school',
	Work = 'work',
	Hospital = 'hospital',
	Outside = 'outside',
	Shopping = 'shopping',
	Transit = 'transit'
}

/**
 *
 */
export enum SocialContext {
	Alone = 'alone',
	Friends = 'friends',
	Family = 'family',
	Peers = 'peers',
	Crowd = 'crowd',
}

/**
 *
 */
const toLAMP = (value?: string): [LocationContext?, SocialContext?] => {
	if (!value) return []
	let matches = (Decrypt(value) || value).toLowerCase()
					.match(/(?:i am )([ \S\/]+)(alone|in [ \S\/]*|with [ \S\/]*)/) || []
	return [
		(<any>{
			'home': LocationContext.Home,
			'in school/class': LocationContext.School,
			'at work': LocationContext.Work,
			'in clinic/hospital': LocationContext.Hospital,
			'outside': LocationContext.Outside,
			'shopping/dining': LocationContext.Shopping,
			'in bus/train/car': LocationContext.Transit,
		})[(matches[1] || ' ').slice(0, -1)],
		(<any>{
			'alone': SocialContext.Alone,
			'with friends': SocialContext.Friends,
			'with family': SocialContext.Family,
			'with peers': SocialContext.Peers,
			'in crowd': SocialContext.Crowd,
		})[(matches[2] || '')]
	]
}

/**
 *
 */
const fromLAMP = (value: [LocationContext?, SocialContext?]): string | undefined => {
	if (!value[0] && !value[1]) return undefined
	return Encrypt('i am' + (<any>{
		'home': ' home',
		'school': ' in school/class',
		'work': ' at work',
		'hospital': ' in clinic/hospital',
		'outside': ' outside',
		'shopping': ' shopping/dining',
		'transit': ' in bus/train/car',
	})[(value[0] || '')] + (<any>{
		'alone': 'alone',
		'friends': 'with friends',
		'family': 'with family',
		'peers': 'with peers',
		'crowd': 'in crowd',
	})[(value[1] || '')])
}

const _decrypt = function(str: string) { let v = Decrypt(str); return (!v || v === '' || v === 'NA') ? undefined : v.toLowerCase() }
const _convert = function(x?: string, strip_suffix: string = '', convert_number: boolean = false) { return !x ? undefined : (convert_number ? parseFloat(x.replace(strip_suffix, '')) : x.replace(strip_suffix, '')) }
const _clean = function(x: any) { return x === 0 ? undefined : x }

/**
 *
 */
const HK_to_LAMP = {
	'lamp.height': (raw: string): any => ({ value: _convert(_decrypt(raw), ' cm', true), units: 'cm' }),
	'lamp.weight': (raw: string): any => ({ value: _convert(_decrypt(raw), ' kg', true), units: 'kg' }),
	'lamp.heart_rate': (raw: string): any => ({ value: _convert(_decrypt(raw), ' bpm', true), units: 'bpm' }),
	'lamp.blood_pressure': (raw: string): any => ({ value: _convert(_decrypt(raw), ' mmhg', false), units: 'mmHg' }),
	'lamp.respiratory_rate': (raw: string): any => ({ value: _convert(_decrypt(raw), ' breaths/min', true), units: 'bpm' }),
	'lamp.sleep': (raw: string): any => ({ value: _decrypt(raw), units: '' }),
	'lamp.steps': (raw: string): any => ({ value: _clean(_convert(_decrypt(raw), ' steps', true)), units: 'steps' }),
	'lamp.flights': (raw: string): any => ({ value: _clean(_convert(_decrypt(raw), ' steps', true)), units: 'flights' }),
	'lamp.segment': (raw: string): any => ({ value: _convert(_decrypt(raw), '', true), units: '' }),
	'lamp.distance': (raw: string): any => ({ value: _convert(_decrypt(raw), ' meters', true), units: 'meters' })
}

/**
 *
 */
const LAMP_to_HK = { // TODO: Consider 0/NA values
	'lamp.height': (obj: { value: any; units: string }): string => `${Encrypt(obj.value)} cm`,
	'lamp.weight': (obj: { value: any; units: string }): string => `${Encrypt(obj.value)} kg`,
	'lamp.heart_rate': (obj: { value: any; units: string }): string => `${Encrypt(obj.value)} bpm`,
	'lamp.blood_pressure': (obj: { value: any; units: string }): string => `${Encrypt(obj.value)} mmhg`,
	'lamp.respiratory_rate': (obj: { value: any; units: string }): string => `${Encrypt(obj.value)} breaths/min`,
	'lamp.sleep': (obj: { value: any; units: string }): string => `${Encrypt(obj.value)}`,
	'lamp.steps': (obj: { value: any; units: string }): string => `${Encrypt(obj.value)} steps`,
	'lamp.flights': (obj: { value: any; units: string }): string => `${Encrypt(obj.value)} steps`,
	'lamp.segment': (obj: { value: any; units: string }): string => `${Encrypt(obj.value)}`,
	'lamp.distance': (obj: { value: any; units: string }): string => `${Encrypt(obj.value)} meters`,
}

/**
 *
 */
const HK_LAMP_map = {
	'lamp.height': 'Height',
	'lamp.weight': 'Weight',
	'lamp.heart_rate': 'HeartRate',
	'lamp.blood_pressure': 'BloodPressure',
	'lamp.respiratory_rate': 'RespiratoryRate',
	'lamp.sleep': 'Sleep',
	'lamp.steps': 'Steps',
	'lamp.flights': 'FlightClimbed',
	'lamp.segment': 'Segment',
	'lamp.distance': 'Distance'
}

/*
@Property()
@Description(d`
	The date and time when the participant last used the LAMP app.
`)
public last_login?: Timestamp

@Property()
@Description(d`
	The type of device the participant last used to use to the LAMP app.
`)
public device_type?: string
*/

/*
@Property()
@Description(d`
	The date and time when the participant last checked the Blogs page.
`)
public blogs_checked_date?: Timestamp

@Property()
@Description(d`
	The date and time when the participant last checked the Tips page.
`)
public tips_checked_date?: Timestamp
*/

// Part Two: Devices! FIXME TIMESTAMP!
/*
let last_login = !!object.last_login ? Encrypt('' + object.last_login!) : 'NULL'
let device_type = !!object.device_type ? Encrypt(object.device_type!) : 'NULL'
*/

/*
if (!!object.last_login)
	updatesC.push(`LastLoginOn = '${object.last_login!}'`)
if (!!object.device_type)
	updatesC.push(`DeviceType = '${object.device_type!}'`)
*/

/*
DATEDIFF_BIG(MS, '1970-01-01', LastLoginOn) AS [last_login],
(CASE 
    WHEN DeviceType = 1 THEN 'iOS'
    WHEN DeviceType = 2 THEN 'Android'
    ELSE NULL
END) AS [device_type],

(
    SELECT DATEDIFF_BIG(MS, '1970-01-01', BlogsViewedOn)
    WHERE BlogsViewedOn IS NOT NULL
) AS [blogs_checked_date],
(
    SELECT DATEDIFF_BIG(MS, '1970-01-01', TipsViewedOn)
    WHERE TipsViewedOn IS NOT NULL
) AS [tips_checked_date],
*/

/*
let result3 = await SQL!.request().query(`
    INSERT INTO UserDevices (
        UserID, 
        DeviceType, 
        LastLoginOn
    )
	VALUES (
	    ${(<any>result1.recordset)['id']},
        '${device_type}'
        '${last_login}',
	);
`)
*/

/*
let result3 = (await SQL!.request().query(`
    UPDATE UserDevices 
    SET ${updatesC.join(', ')} 
    LEFT JOIN Users ON Users.UserID = UserDevices.UserID
    WHERE StudyId = ${user_id};
`)).recordset
*/

/*
public static function get_streams(
	$access_key,
	$secret_key,
	$study_id,
	$user_id,
	$data_streams
) {

	// Convert the data streams list to a JSON string.
	if (count($data_streams) === 0)
		return new stdClass();

	$access_key = urlencode($access_key);
	$secret_key = urlencode($secret_key);
	$data_streams = json_encode($data_streams);

	// Write CURL body from the POST request into a temporary file.
	$fp = fopen("/tmp/tmp.zip", 'w');
	$ch = curl_init();
	curl_setopt($ch, CURLOPT_URL, "https://studies.beiwe.org/get-data/v1");
	curl_setopt($ch, CURLOPT_POST, 1);
	curl_setopt($ch, CURLOPT_POSTFIELDS, "access_key=$access_key&secret_key=$secret_key&study_id=$study_id&user_ids=[\"$user_id\"]&data_streams=$data_streams");
	curl_setopt($ch, CURLOPT_FILE, $fp);
	curl_exec($ch);
	curl_close($ch);
	fclose($fp);

	// Open and iterate all files within the downloaded archive.
	$summary = [];
	$zip = new ZipArchive();
	$zip->open('/tmp/tmp.zip');
	for($i = 0; $i < $zip->numFiles; $i++) {
		$path = explode('/', $zip->getNameIndex($i));

		// Ignore files that are not within the main user ID directory.
		if ($path[0] !== $user_id)
			continue;

		// Accumulate the CSV file under the summary object.
		if(!isset($summary[$path[1]]))
			$summary[$path[1]] = [];

		// Convert the CSV file into an indexed object.
		$rows = array_map('str_getcsv', explode("\n", $zip->getFromIndex($i)));
		$header = array_map(function ($x) {
			return str_replace(' ', '_', $x);
		}, array_shift($rows));
		foreach($rows as $row) {
			$data = array_combine($header, $row);
			$data['timestamp'] = intval($data['timestamp']); // Convert to number!
			unset($data['UTC_time']); // Not needed in our data format!
			$summary[$path[1]][] = $data;
		}
	}

	// Clean up and return the object downloaded.
	$zip->close();
	unlink('/tmp/tmp.zip');
	return $summary;
}
*/

