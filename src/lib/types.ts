export interface Question {
  _id?: string;
  question: string;
  options: string[];
  correct_answer_index: number;
  subject: string;
  topic: string;
  sub_topic?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  created_at?: Date;
}

export interface QuestionPaper {
  _id?: string;
  title: string;
  question_ids: string[];
  omr_type: number; // যেমন: ২০, ৫০, ১০০
  created_at: Date;
}
