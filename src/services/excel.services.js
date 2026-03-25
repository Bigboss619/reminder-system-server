import * as XLSX from "xlsx";

/* =========================
   UNIVERSAL DATE PARSER
========================== */
const parseUniversalDate = (excelValue) => {
  if (!excelValue || excelValue === "" || excelValue === null) return null;
  
  let value = excelValue.toString().trim();
  
  // ✅ Already valid ISO date
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  
  // ✅ Excel serial numbers (44927 = 2023-01-01)
  if (typeof excelValue === 'number') {
    try {
      const date = XLSX.SSF.parse_date_code(excelValue);
      if (date) {
        return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
      }
    } catch (e) {
      // Continue to string parsing
    }
  }
  
  // ✅ All common formats: DD/MM/YYYY, MM/DD/YYYY, YYYY/MM/DD, etc.
  const datePatterns = [
    // DD/MM/YYYY or DD-MM-YYYY
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,
    // YYYY/MM/DD or YYYY-MM-DD
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
    // MM/DD/YYYY or MM-DD-YYYY
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/
  ];
  
  for (const pattern of datePatterns) {
    const match = value.match(pattern);
    if (match) {
      let year = parseInt(match[3]);
      let month = parseInt(match[1]);
      let day = parseInt(match[2]);
      
      // Auto-detect DD/MM vs MM/DD
      if (month > 12) {
        [month, day] = [day, month]; // Swap if month > 12
      }
      
      const date = new Date(year, month - 1, day);
      if (!isNaN(date.getTime()) && date.getFullYear() === year) {
        return date.toISOString().split('T')[0];
      }
    }
  }
  
  // ✅ Fallback for text dates
  const date = new Date(value);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split('T')[0];
  }
  
  return null;
};

export const parseExcelFile = (fileBuffer) => {
  const workbook = XLSX.read(fileBuffer, { type: "buffer", dateNF: "dd/mm/yyyy" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: "", raw: false });

  const errors = [];
  const warnings = [];
  const validRows = [];
  let totalDocuments = 0;

  /* =========================
     FIRST PASS (VALIDATION) - UNCHANGED
  ========================= */
  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    const rowNum = i + 2;

    const name = (row["Name of Vehicle"] || "").toString().trim();
    const regNumber = (row["Reg Number"] || "").toString().trim();
    const chassisNumber = (row["Chasis Number"] || "").toString().trim();
    const staffEmail = (row["staff_email"] || "").toString().trim();

    // Skip empty rows
    if (!name && !regNumber && !chassisNumber) continue;

    if (!name) {
      errors.push(`Row ${rowNum}: Name of Vehicle is required`);
      continue;
    }

    if (!regNumber) {
      errors.push(`Row ${rowNum}: Reg Number is required`);
      continue;
    }

    if (!chassisNumber) {
      errors.push(`Row ${rowNum}: Chasis Number is required`);
      continue;
    }

    // Email validation (optional)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (staffEmail && !emailRegex.test(staffEmail)) {
      errors.push(`Row ${rowNum}: Invalid staff email`);
      continue;
    }

    validRows.push({ row, rowNum });
  }

  /* =========================
     SECOND PASS (GROUPING) - FULLY FIXED
  ========================= */
  const vehicleMap = new Map();

  for (const { row, rowNum } of validRows) {
    const chassisNumber = (row["Chasis Number"] || "").toString().trim();
    
    if (!vehicleMap.has(chassisNumber)) {
      const vehicle = {
        name: (row["Name of Vehicle"] || "").toString().trim(),
        reg_number: (row["Reg Number"] || "").toString().trim(),
        chassis_number: chassisNumber,
        model: (row["Vehicle Description"] || "").toString().trim(),
        brand: (row["Brand"] || "").toString().trim(),
        year_accquired: row["Year Acquired"] ? parseInt(row["Year Acquired"], 10) : null,
        color: (row["Color"] || "").toString().trim(),
        SBU: (row["SBU"] || "").toString().trim(),
        staff_name: (row["Assigned Staff/Comp"] || "").toString().trim(),
        staff_email: (row["staff_email"] || "").toString().trim() || null,
        status: "active",
      };

      vehicleMap.set(chassisNumber, {
        vehicle,
        documents: [],
        maintenance: [],
        rowNum,
      });
    }

    const vehicleData = vehicleMap.get(chassisNumber);

    /* =========================
       DOCUMENTS - ✅ ALL FORMATS SUPPORTED
    ========================= */
    const addDocument = (name, expiryCell, issueCell = null) => {
      const expiryDate = parseUniversalDate(expiryCell);
      const issueDate = issueCell ? parseUniversalDate(issueCell) : null;
      
      // Only add valid expiry dates
      if (expiryDate && !vehicleData.documents.some(d => d.name === name)) {
        const doc = {
          name,
          // For database insert (ISO format)
          issueDate,
          expiryDate,
          // For preview table display (human readable)
          issueDateDisplay: issueDate || 'No issue date',
          expiryDateDisplay: expiryDate,
          reminder: null
        };
        vehicleData.documents.push(doc);
        totalDocuments++;
      }
    };

    // Process ALL document columns
    addDocument("Road Worthiness", row["Road Worthiness Expiry"]);
    addDocument("Vehicle License", row["Vehicle Lincense Expiry"]);
    addDocument("Proof of Ownership", row["Proof of Ownership"]);
    addDocument("Insurance", row["Insurance Expiry"]);
    addDocument("Local Govt Certificate", 
      row["Local  Govt Date of Expiry"] || row["Local Govt Date of Expiry"], 
      row["Local Govt Date Issue"]
    );

    /* =========================
       MAINTENANCE - ✅ FIXED DATES
    ========================= */
    const lastServicedInput = row["Last Serviced Year"] || row["Last Serviced Date"];
    const lastServiceDate = parseUniversalDate(lastServicedInput);
    
    if (!vehicleData.maintenance.some(m => m.type === "Annual Maintenance")) {
      vehicleData.maintenance.push({
        type: "Annual Maintenance",
        lastService: lastServiceDate,
        lastServiceDisplay: lastServiceDate || 'Not serviced',
        nextDue: null,
      });
    }
  }

  const vehicles = Array.from(vehicleMap.values());

  console.log(`✅ Parsed ${vehicles.length} vehicles, ${totalDocuments} documents`);

  return {
    vehicles,
    errors,
    warnings,
    totalRows: rawData.length,
    totalDocuments
  };
};

// Keep your existing functions unchanged
export const checkDuplicateVINs = (vehicles) => {
  const vinCount = new Map();
  const duplicates = [];

  vehicles.forEach((vehicleData) => {
    const vin = vehicleData.vehicle.chassis_number.toString().trim().toUpperCase();
    if (!vin) return;

    vinCount.set(vin, (vinCount.get(vin) || 0) + 1);
  });

  vehicles.forEach((vehicleData) => {
    const vin = vehicleData.vehicle.chassis_number.toString().trim().toUpperCase();
    if (vin && vinCount.get(vin) > 1) {
      duplicates.push(`Row ${vehicleData.rowNum}: Duplicate VIN/Chassis Number "${vin}" found`);
    }
  });

  return duplicates;
};

export const checkExistingVehicles = async (vehicles, supabase, departmentId) => {
  const existingErrors = [];
  const excelPlates = vehicles.map(v => v.vehicle.reg_number.toString().trim().toUpperCase());
  const excelVins = vehicles.map(v => v.vehicle.chassis_number.toString().trim().toUpperCase());

  const { data: existingAssets, error } = await supabase
    .from('assets')
    .select(`vehicle_details (reg_number, chassis_number)`)
    .eq('department_id', departmentId)
    .eq('asset_type', 'vehicle');

  if (error) {
    console.error('Database query error:', error);
    return [];
  }

  const existingVehicles = existingAssets.flatMap(asset => 
    asset.vehicle_details?.map(vd => ({ 
      reg_number: vd.reg_number, 
      chassis_number: vd.chassis_number 
    })) || []
  );

  existingVehicles.forEach(existing => {
    const existingPlate = existing.reg_number?.toString().trim().toUpperCase();
    const existingVin = existing.chassis_number?.toString().trim().toUpperCase();

    if (existingPlate && excelPlates.includes(existingPlate)) {
      const matchingVehicle = vehicles.find(v => 
        v.vehicle.reg_number.toString().trim().toUpperCase() === existingPlate
      );
      if (matchingVehicle) {
        existingErrors.push(
          `Row ${matchingVehicle.rowNum}: Reg Number "${existingPlate}" already exists`
        );
      }
    }

    if (existingVin && excelVins.includes(existingVin)) {
      const matchingVehicle = vehicles.find(v => 
        v.vehicle.chassis_number.toString().trim().toUpperCase() === existingVin
      );
      if (matchingVehicle) {
        existingErrors.push(
          `Row ${matchingVehicle.rowNum}: Chassis Number "${existingVin}" already exists`
        );
      }
    }
  });

  return existingErrors;
};

export const generateTemplate = () => {
  const wb = XLSX.utils.book_new();
  const headers = [
    "Name of Vehicle", "Reg Number", "Chasis Number", "Vehicle Description", "Brand",
    "staff_email", "Assigned Staff/Comp", "SBU", "Road Worthiness Expiry",
    "Vehicle Lincense Expiry", "Proof of Ownership", "Insurance Expiry",
    "Year Acquired", "Last Serviced Date", "Local Govt Date Issue", "Local  Govt Date of Expiry"
  ];

  const sampleData = [
    ["Toyota Corolla Fleet 001", "ABC 123 AA", "JTDKDTB3XJ1234567", "Corolla 1.8L", "Toyota", 
     "john@company.com", "John Doe", "Distribution", "15/06/2025", "20/03/2025", "01/01/2026", "28/02/2025", 
     2023, "15/01/2025", "10/01/2024", "10/01/2025"],
    ["Honda Accord Fleet 002", "XYZ 456 BB", "1HGCR2F3XFA000123", "Accord Hybrid", "Honda", 
     "jane@company.com", "Jane Smith", "Operations", "20/07/2025", "10/04/2025", "15/02/2026", "15/03/2025", 
     2022, "20/06/2024", "05/02/2024", "05/02/2025"],
    ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]
  ];

  const wsData = [headers, ...sampleData];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  
  const colWidths = headers.map(h => ({ wch: Math.max(15, h.length + 2) }));
  ws['!cols'] = colWidths;
  
  XLSX.utils.book_append_sheet(wb, ws, "Vehicle Template");
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};