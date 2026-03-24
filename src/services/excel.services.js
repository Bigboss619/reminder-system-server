import * as XLSX from "xlsx";

export const parseExcelFile = (fileBuffer) => {
  const workbook = XLSX.read(fileBuffer, { type: "buffer" });

  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

  const errors = [];
  const warnings = [];
  const validRows = [];

  /* =========================
     FIRST PASS (VALIDATION)
  ========================= */
  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    const rowNum = i + 2;

    const name = (row["Name of Vehicle"] || "").toString().trim();
    const regNumber = (row["Reg Number"] || "").toString().trim();
    const chassisNumber = (row["Chasis Number"] || "").toString().trim();
    const staffName = (row["Assigned Staff/Comp"] || "").toString().trim();
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

    if (!staffName) {
      errors.push(`Row ${rowNum}: Assigned Staff/Comp is required`);
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
     SECOND PASS (GROUPING)
  ========================= */
  const vehicleMap = new Map();

  for (const { row, rowNum } of validRows) {
    const name = (row["Name of Vehicle"] || "").toString().trim();
    const regNumber = (row["Reg Number"] || "").toString().trim();
    const chassisNumber = (row["Chasis Number"] || "").toString().trim();
    const staffName = (row["Assigned Staff/Comp"] || "").toString().trim();
    const staffEmail = (row["staff_email"] || "").toString().trim();

    if (!vehicleMap.has(chassisNumber)) {
      const vehicle = {
        name,
        reg_number: regNumber,
        chassis_number: chassisNumber,
        model: (row["Vehicle Description"] || "").toString().trim(),
        brand: (row["Brand"] || "").toString().trim(),
        year_accquired: row["Year Acquired"]
          ? parseInt(row["Year Acquired"], 10)
          : null,
        color: "",
        SBU: (row["SBU"] || "").toString().trim(),
        staff_name: staffName,
        staff_email: staffEmail || null,
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
       DOCUMENTS (AUTO)
    ========================= */

    const addDoc = (name, expiry, issue = null) => {
      if (!expiry) return;

      if (!vehicleData.documents.some(d => d.name === name)) {
        vehicleData.documents.push({
          name,
          issueDate: issue,
          expiryDate: expiry,
        });
      }
    };

    addDoc("Road Worthiness", row["Road Worthiness Expiry"]);
    addDoc("Vehicle License", row["Vehicle Lincense Expiry"]);
    addDoc("Proof of Ownership", row["Proof of Ownership"]);
    addDoc("Insurance", row["Insurance Expiry"]);

    addDoc(
      "Local Govt Certificate",
      row["Local  Govt Date of Expiry"] || row["Local Govt Date of Expiry"],
      row["Local Govt Date Issue"]
    );

    /* =========================
       MAINTENANCE
    ========================= */
    const lastServicedInput = row["Last Serviced Year"];
    let lastServiceDate = null;

    if (lastServicedInput != null && lastServicedInput !== "") {
      if (typeof lastServicedInput === "number") {
        lastServiceDate = new Date(lastServicedInput, 0, 1).toISOString().split('T')[0];
      } else {
        const str = String(lastServicedInput).trim();
        // Validate YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
          const date = new Date(str + "T00:00:00");
          if (!isNaN(date.getTime())) {
            lastServiceDate = str;
          }
        }
      }
    }

    // Always create default maintenance record, even if no last serviced date
    if (!vehicleData.maintenance.some(m => m.type === "Annual Maintenance")) {
      vehicleData.maintenance.push({
        type: "Annual Maintenance",
        lastService: lastServiceDate,
        nextDue: null,
      });
    }
  }

  const vehicles = Array.from(vehicleMap.values());

  return {
    vehicles,
    errors,
    warnings,
    totalRows: rawData.length,
  };
};

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

  // Get all plate_numbers and vins from Excel data
  const excelPlates = vehicles.map(v => v.vehicle.reg_number.toString().trim().toUpperCase());
  const excelVins = vehicles.map(v => v.vehicle.chassis_number.toString().trim().toUpperCase());

  // Query assets in department, select vehicle_details.reg_number, chassis_number
  const { data: existingAssets, error } = await supabase
    .from('assets')
    .select(`
      vehicle_details (
        reg_number,
        chassis_number
      )
    `)
    .eq('department_id', departmentId)
    .eq('asset_type', 'vehicle');

  if (error) {
    console.error('Database query error:', error);
    return [];
  }

  // Flatten vehicle_details array (usually 1:1)
  const existingVehicles = existingAssets.flatMap(asset => 
    asset.vehicle_details?.map(vd => ({ 
      reg_number: vd.reg_number, 
      chassis_number: vd.chassis_number 
    })) || []
  );

  existingVehicles.forEach(existing => {
    const existingPlate = existing.reg_number?.toString().trim().toUpperCase();
    const existingVin = existing.chassis_number?.toString().trim().toUpperCase();

    // Check plate number duplicates
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

    // Check VIN duplicates
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
  // Create workbook with sample headers matching parseExcelFile expectations
  const wb = XLSX.utils.book_new();

  const headers = [
    "Name of Vehicle",
    "Reg Number",
    "Chasis Number",
    "Vehicle Description",
    "Brand",
    "staff_email",
    "Assigned Staff/Comp",
    "SBU",
    "Road Worthiness Expiry",
    "Vehicle Lincense Expiry",
    "Proof of Ownership",
    "Insurance Expiry",
    "Year Acquired",
    "Last Serviced Date",
    "Local Govt Date Issue",
    "Local  Govt Date of Expiry"
  ];

  // Create sample data rows
  const sampleData = [
    ["Toyota Corolla Fleet 001", "ABC 123 AA", "JTDKDTB3XJ1234567", "Corolla Sedan 1.8L", "Toyota", "john.doe@nepa.com", "John Doe", "Distribution", "2025-06-15", "2025-03-20", "2026-01-01", "2025-02-28", "2023", "2025-01-15", "2024-01-10", "2025-01-10"],
    ["Honda Accord Fleet 002", "XYZ 456 BB", "1HGCR2F3XFA000123", "Accord 2.0L Hybrid", "Honda", "jane.smith@nepa.com", "Jane Smith", "Operations", "2025-07-20", "2025-04-10", "2026-02-15", "2025-03-15", "2022", "2024-06-20", "2024-02-05", "2025-02-05"],
    ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]
  ];

  const wsData = [headers, ...sampleData];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  
  // Auto-size columns
  const colWidths = headers.map(h => ({ wch: Math.max(15, h.length + 2) }));
  ws['!cols'] = colWidths;
  
  XLSX.utils.book_append_sheet(wb, ws, "Vehicle Template");
  
  // Generate buffer
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return buffer;
};
