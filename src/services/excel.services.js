import * as XLSX from "xlsx";

/**
 * Parse Excel file and extract vehicle data with documents and maintenance
 * @param {Buffer} fileBuffer - The Excel file buffer
 * @returns {Object} - Parsed data with vehicles, errors, and warnings
 */
export const parseExcelFile = (fileBuffer) => {
  const workbook = XLSX.read(fileBuffer, { type: "buffer" });
  
  // Get the first sheet
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  // Convert to JSON
  const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
  
  const errors = [];
  const warnings = [];
  
  // First pass: validate all rows and collect them
  const validRows = [];
  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    const rowNum = i + 2; // Excel row number (1-indexed + header)
    
    // Skip completely empty rows
    if (!row.name && !row.plate_number && !row.vin) {
      continue;
    }
    
    // Required fields validation
    if (!row.name || row.name.toString().trim() === "") {
      errors.push(`Row ${rowNum}: Vehicle name is required`);
      continue;
    }
    
    if (!row.plate_number || row.plate_number.toString().trim() === "") {
      errors.push(`Row ${rowNum}: Plate number is required`);
      continue;
    }
    
    if (!row.vin || row.vin.toString().trim() === "") {
      errors.push(`Row ${rowNum}: VIN is required`);
      continue;
    }
    
    if (!row.staff_name || row.staff_name.toString().trim() === "") {
      errors.push(`Row ${rowNum}: Staff name is required`);
      continue;
    }
    
    if (!row.staff_email || row.staff_email.toString().trim() === "") {
      errors.push(`Row ${rowNum}: Staff email is required`);
      continue;
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(row.staff_email)) {
      errors.push(`Row ${rowNum}: Invalid email format for staff email`);
      continue;
    }
    
    // Validate expiry date if provided
    if (row.document_expiry_date) {
      const expiryDate = new Date(row.document_expiry_date);
      if (isNaN(expiryDate.getTime())) {
        errors.push(`Row ${rowNum}: Invalid document expiry date format`);
        continue;
      }
      if (expiryDate < new Date()) {
        warnings.push(`Row ${rowNum}: Document expiry date is in the past`);
      }
    }
    
    // Validate maintenance next due date if provided
    if (row.maintenance_next_due) {
      const nextDue = new Date(row.maintenance_next_due);
      if (isNaN(nextDue.getTime())) {
        errors.push(`Row ${rowNum}: Invalid maintenance next due date format`);
        continue;
      }
    }
    
    // Validate year if provided
    if (row.year) {
      const year = parseInt(row.year, 10);
      if (isNaN(year) || year < 1900 || year > new Date().getFullYear() + 1) {
        warnings.push(`Row ${rowNum}: Year seems invalid`);
      }
    }
    
    validRows.push({ row, rowNum });
  }
  
  // Second pass: group by plate_number to combine documents and maintenance
  const vehicleMap = new Map();
  
  for (const { row, rowNum } of validRows) {
    const plateNumber = row.plate_number?.toString().trim();
    
    // Get vehicle info (only from first occurrence)
    if (!vehicleMap.has(plateNumber)) {
      const vehicle = {
        name: row.name?.toString().trim() || "",
        plate_number: plateNumber,
        vin: row.vin?.toString().trim() || "",
        model: row.model?.toString().trim() || "",
        year: row.year ? parseInt(row.year, 10) : null,
        color: row.color?.toString().trim() || "",
        staff_name: row.staff_name?.toString().trim() || "",
        staff_email: row.staff_email?.toString().trim() || "",
        status: row.status?.toString().trim() || "active"
      };
      
      vehicleMap.set(plateNumber, {
        vehicle,
        documents: [],
        maintenance: [],
        rowNum
      });
    }
    
    const vehicleData = vehicleMap.get(plateNumber);
    
    // Add document if present
    if (row.document_name && row.document_name.toString().trim() !== "") {
      // Check if this document type already exists for this vehicle
      const existingDocIndex = vehicleData.documents.findIndex(
        d => d.name.toLowerCase() === row.document_name?.toString().trim().toLowerCase()
      );
      
      if (existingDocIndex === -1) {
        vehicleData.documents.push({
          name: row.document_name?.toString().trim() || "",
          issueDate: row.document_issue_date || null,
          expiryDate: row.document_expiry_date || null
        });
      }
    }
    
    // Add maintenance if present
    if (row.maintenance_type && row.maintenance_type.toString().trim() !== "") {
      // Check if this maintenance type already exists for this vehicle
      const existingMaintIndex = vehicleData.maintenance.findIndex(
        m => m.type.toLowerCase() === row.maintenance_type?.toString().trim().toLowerCase()
      );
      
      if (existingMaintIndex === -1) {
        vehicleData.maintenance.push({
          type: row.maintenance_type?.toString().trim() || "",
          lastService: row.maintenance_last_service || null,
          nextDue: row.maintenance_next_due || null
        });
      }
    }
  }
  
  const vehicles = Array.from(vehicleMap.values());
  
  return {
    vehicles,
    errors,
    warnings,
    totalRows: rawData.length
  };
};

/**
 * Check for duplicate VINs in the parsed data
 * @param {Array} vehicles - Array of parsed vehicle objects
 * @returns {Array} - Array of duplicate VIN errors
 */
export const checkDuplicateVINs = (vehicles) => {
  const vinMap = new Map();
  const duplicates = [];
  
  for (const item of vehicles) {
    const vin = item.vehicle.vin;
    if (vinMap.has(vin)) {
      duplicates.push(`Plate "${item.vehicle.plate_number}": Duplicate VIN "${vin}" (also found in "${vinMap.get(vin)}")`);
    } else {
      vinMap.set(vin, item.vehicle.plate_number);
    }
  }
  
  return duplicates;
};

/**
 * Generate Excel template for batch upload
 * @returns {Buffer} - Excel file buffer
 */
export const generateTemplate = () => {
  try {
    const templateData = [
      // First vehicle with 1 document and 1 maintenance
      {
        name: "Vehicle 1",
        plate_number: "ABC-1234",
        vin: "1HGBH41JXMN109186",
        model: "Toyota Camry",
        year: 2023,
        color: "Silver",
        staff_name: "John Doe",
        staff_email: "john.doe@example.com",
        status: "active",
        document_name: "Insurance",
        document_issue_date: "2024-01-01",
        document_expiry_date: "2025-01-01",
        maintenance_type: "Oil Change",
        maintenance_last_service: "2024-06-01",
        maintenance_next_due: "2024-12-01"
      },
      // Same vehicle (ABC-1234) with additional document and maintenance
      {
        name: "Vehicle 1",
        plate_number: "ABC-1234",
        vin: "1HGBH41JXMN109186",
        model: "Toyota Camry",
        year: 2023,
        color: "Silver",
        staff_name: "John Doe",
        staff_email: "john.doe@example.com",
        status: "active",
        document_name: "Registration",
        document_issue_date: "2024-01-15",
        document_expiry_date: "2025-01-15",
        maintenance_type: "Tire Rotation",
        maintenance_last_service: "2024-05-15",
        maintenance_next_due: "2024-11-15"
      },
      // Second vehicle (different plate_number)
      {
        name: "Vehicle 2",
        plate_number: "XYZ-5678",
        vin: "2HGBH41JXMN109187",
        model: "Honda Civic",
        year: 2022,
        color: "Black",
        staff_name: "Jane Smith",
        staff_email: "jane.smith@example.com",
        status: "active",
        document_name: "Insurance",
        document_issue_date: "2024-02-01",
        document_expiry_date: "2025-02-01",
        maintenance_type: "Brake Service",
        maintenance_last_service: "2024-04-01",
        maintenance_next_due: "2024-10-01"
      }
    ];
    
    const worksheet = XLSX.utils.json_to_sheet(templateData);
    
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Vehicle Template");
    
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    return buffer;
  } catch (error) {
    console.error("Error generating template:", error);
    throw error;
  }
};

/**
 * Validate parsed vehicles against database for duplicates
 * @param {Array} vehicles - Array of parsed vehicle objects
 * @param {Object} supabase - Supabase client
 * @param {String} departmentId - Department ID to check against
 * @returns {Array} - Array of existing vehicle errors
 */
export const checkExistingVehicles = async (vehicles, supabase, departmentId) => {
  const errors = [];
  const plateNumbers = vehicles.map(v => v.vehicle.plate_number);
  const vins = vehicles.map(v => v.vehicle.vin);
  
  // Check for existing plate numbers in the same department
  const { data: existingPlates, error: plateError } = await supabase
    .from("vehicle_details")
    .select("id, plate_number, asset_id")
    .in("plate_number", plateNumbers);
  
  if (!plateError && existingPlates && existingPlates.length > 0) {
    // Check if these vehicles belong to the same department
    const assetIds = existingPlates.map(v => v.asset_id);
    const { data: assets } = await supabase
      .from("assets")
      .select("id, department_id")
      .in("id", assetIds);
    
    if (assets) {
      const sameDeptAssets = assets.filter(a => a.department_id === departmentId);
      if (sameDeptAssets.length > 0) {
        const sameDeptIds = sameDeptAssets.map(a => a.id);
        const conflictingPlates = existingPlates.filter(p => sameDeptIds.includes(p.asset_id));
        
        for (const plate of conflictingPlates) {
          const row = vehicles.find(v => v.vehicle.plate_number === plate.plate_number);
          if (row) {
            errors.push(`Row ${row.rowNum}: Plate number "${plate.plate_number}" already exists in your department`);
          }
        }
      }
    }
  }
  
  // Check for existing VINs (global check - VINs should be unique everywhere)
  const { data: existingVins, error: vinError } = await supabase
    .from("vehicle_details")
    .select("id, vin, asset_id")
    .in("vin", vins);
  
  if (!vinError && existingVins && existingVins.length > 0) {
    for (const vin of existingVins) {
      const row = vehicles.find(v => v.vehicle.vin === vin.vin);
      if (row) {
        errors.push(`Row ${row.rowNum}: VIN "${vin.vin}" already exists in the system`);
      }
    }
  }
  
  return errors;
};

