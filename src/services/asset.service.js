import { supabase } from "../config/supabase.js";
import { v4 as uuidv4 } from "uuid";

export const createAsset = async (data) => {
  const newAsset = {
    id: uuidv4(),
    ...data,
    created_at: new Date()
  };

  const { data: result, error } = await supabase
    .from("assets")
    .insert([newAsset])
    .select()
    .single();

  if (error) throw error;

  return result;
};

export const getAllAssets = async () => {
  const { data, error } = await supabase
    .from("assets")
    .select("*");

  if (error) throw error;

  return data;
};
