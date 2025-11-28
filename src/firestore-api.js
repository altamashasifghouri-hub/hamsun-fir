import { db, storage, auth, onAuthStateChanged } from "./firebase";
// ... use db for Firestore operations
// ... use storage for image uploads
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  updateDoc, 
  doc, 
  query, 
  orderBy, 
  serverTimestamp 
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

// The name of our Firestore Collection
const ISSUES_COLLECTION = "maintenance_issues";

// ===================================
// 1. READ: Get Real-time Issues
// ===================================
// This function sets up the real-time listener (onSnapshot)
export const subscribeToIssues = (callback) => {
  const q = query(collection(db, ISSUES_COLLECTION), orderBy("createdAt", "desc"));
  
  // onSnapshot is Firebase's real-time listener
  const unsubscribe = onSnapshot(q, (snapshot) => {
    const issuesData = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    // Pass the fetched data back to the component (App.js)
    callback(issuesData);
  });

  return unsubscribe; // Return the function to stop listening when component unmounts
};

// ===================================
// 2. CREATE: Submit a New Issue
// ===================================
export const createNewIssue = async (formData, customId) => {
  let imageUrl = "";

  // A. Upload Image (if file exists)
  if (formData.imageFile) {
    const imageRef = ref(storage, `fir_images/${Date.now()}_${formData.imageFile.name}`);
    const snapshot = await uploadBytes(imageRef, formData.imageFile);
    imageUrl = await getDownloadURL(snapshot.ref);
  }

  // B. Save Data to Firestore
  const newIssueData = {
    displayId: customId,
    roomNumber: formData.roomNumber,
    issueTitle: formData.issueTitle,
    description: formData.description,
    imageUrl: imageUrl,
    status: "Submit",
    priority: "Medium",
    department: "Select Department",
    createdAt: serverTimestamp(),
    dateTimeString: new Date().toLocaleString()
  };

  await addDoc(collection(db, ISSUES_COLLECTION), newIssueData);
};

// ===================================
// 3. UPDATE: Change Status, Priority, or Department
// ===================================
export const updateIssueField = async (docId, field, value) => {
  const issueRef = doc(db, ISSUES_COLLECTION, docId);
  await updateDoc(issueRef, {
    [field]: value
  });
};